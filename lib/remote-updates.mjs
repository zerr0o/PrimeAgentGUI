import { formatMessage as tr } from '../public/i18n-core.js';
import { lstat, readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './store.mjs';
import { acquireLock } from '../scripts/launcher-common.mjs';

// Fixed upstream only. Never accept a URL from any request body or file.
export const UPDATER_META_URL =
  'https://github.com/zerr0o/prime-agent-studio/releases/latest/download/latest.json';
export const METADATA_TTL_MS = 5 * 60 * 1000;
export const REQUEST_TTL_MS = 15 * 60 * 1000;
export const HEARTBEAT_STALE_MS = 60 * 1000;
const MAX_META_BYTES = 64 * 1024;
const MAX_NOTES_CHARS = 32 * 768;
const MAX_FILE_BYTES = 16 * 1024;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const INSTALLER_URL =
  /^https:\/\/github\.com\/zerr0o\/prime-agent-studio\/releases\/download\/v\d+\.\d+\.\d+\/Prime-Agent-Studio_\d+\.\d+\.\d+_x64-setup\.exe$/;
// Terminal intent states. Anything else counts as live for duplicate rejection.
const TERMINAL = new Set(['installed', 'installed_pending_restart', 'failed', 'refused', 'expired']);

export function parseSemver(value) {
  const match = SEMVER.exec(String(value || ''));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareSemver(a, b) {
  const pa = parseSemver(a),
    pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

export function createRemoteUpdates({
  dataDir,
  installedVersion,
  getActiveRuns = () => 0,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const intentFile = join(dataDir, 'update-request.json');
  const heartbeatFile = join(dataDir, 'update-poller.json');
  let published = null; // { version, notes, fetchedAt }
  let metaError = '';
  let metadataFetch;
  const createdAt = []; // sliding window of request-creation timestamps (rate limit)

  async function readJsonCapped(path, maxBytes) {
    try {
      // Size cap before parse; symlinks rejected like the access-code reader.
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) return null;
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return null;
    }
  }

  // Shared cross-process protocol (Node server + Rust poller must mirror it):
  // - Mutual exclusion via lock file update-request.lock, content {pid, createdAt},
  //   acquired with O_EXCL ('wx'). Stale takeover: holder pid dead, or createdAt
  //   older than 60 s. scripts/launcher-common.mjs acquireLock implements this.
  // - Every read-modify-write (create, expiry, all native status transitions)
  //   runs under that lock AND re-verifies id/rev inside it. rev alone is not CAS.
  // - Atomic writes: tmp `${path}.${randomUUID()}.tmp` with flag 'wx' mode 0o600,
  //   then rename. Never write through a symlink: refuse instead.
  async function withIntentLock(timeout, task) {
    const release = await acquireLock({ lock: join(dataDir, 'update-request.lock') }, { timeout });
    try {
      return await task();
    } finally {
      await release();
    }
  }

  async function assertWritableDir() {
    const info = await lstat(dataDir).catch(() => null);
    if (info && info.isSymbolicLink()) throw new HttpError(500, tr('server.demande_de_mise_a_jour_invalide'));
  }

  async function writeJsonAtomic(path, value) {
    await mkdir(dataDir, { recursive: true });
    await assertWritableDir();
    const target = await lstat(path).catch(() => null);
    if (target && target.isSymbolicLink())
      throw new HttpError(500, tr('server.demande_de_mise_a_jour_invalide'));
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  function validIntent(value) {
    return (
      value &&
      !Array.isArray(value) &&
      value.schema === 1 &&
      typeof value.id === 'string' &&
      /^[0-9a-f-]{36}$/.test(value.id) &&
      Number.isInteger(value.rev) &&
      value.rev >= 0 &&
      parseSemver(value.version) &&
      typeof value.restartServer === 'boolean' &&
      typeof value.requestedAt === 'string' &&
      typeof value.expiresAt === 'string' &&
      typeof value.status === 'string' &&
      typeof value.statusAt === 'string' &&
      typeof value.detail === 'string'
    );
  }

  async function readIntent() {
    const value = await readJsonCapped(intentFile, MAX_FILE_BYTES);
    return validIntent(value) ? value : null;
  }

  function isLive(intent, at) {
    if (!intent) return false;
    if (TERMINAL.has(intent.status)) return false;
    if (intent.status === 'pending' && Date.parse(intent.expiresAt) <= at) return false;
    return true;
  }

  function fetchPublished({ force = false } = {}) {
    if (metadataFetch) return metadataFetch;
    if (!force && published && now() - published.fetchedAt < METADATA_TTL_MS)
      return Promise.resolve(published);
    metadataFetch = fetchPublishedFresh(force).finally(() => {
      metadataFetch = undefined;
    });
    return metadataFetch;
  }

  async function fetchPublishedFresh(force) {
    const at = now();
    let response;
    try {
      response = await fetchImpl(UPDATER_META_URL, {
        signal: AbortSignal.timeout(15000),
        ...(force ? { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } } : {}),
      });
    } catch {
      metaError = tr('server.mise_a_jour_indisponible_verifiez_votre_connexion');
      return published;
    }
    try {
      if (!response.ok) throw new Error();
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > MAX_META_BYTES) throw new Error();
        chunks.push(chunk);
      }
      // Undici also offers .text(); stream manually to enforce the byte cap.
      const raw = Buffer.concat(chunks).toString('utf8');
      const data = JSON.parse(raw);
      const version = data?.version;
      const notes = data?.notes ?? '';
      const target = data?.platforms?.['windows-x86_64'];
      if (
        !parseSemver(version) ||
        typeof notes !== 'string' ||
        notes.length > MAX_NOTES_CHARS ||
        typeof target?.url !== 'string' ||
        !INSTALLER_URL.test(target.url) ||
        typeof target?.signature !== 'string' ||
        !target.signature.trim()
      )
        throw new Error();
      // Only version + notes leave the server. URL/signature stay private.
      published = { version, notes, fetchedAt: at };
      metaError = '';
    } catch {
      metaError = tr('server.mise_a_jour_indisponible_verifiez_votre_connexion');
    }
    return published;
  }

  async function readHeartbeat(at) {
    const beat = await readJsonCapped(heartbeatFile, 4096);
    const aliveAt = Date.parse(beat?.aliveAt);
    if (!beat || beat.schema !== 1 || !Number.isFinite(aliveAt)) return { alive: false };
    if (at - aliveAt > HEARTBEAT_STALE_MS) return { alive: false, aliveAt: beat.aliveAt };
    return {
      alive: true,
      aliveAt: beat.aliveAt,
      appVersion: parseSemver(beat.appVersion) ? beat.appVersion : null,
    };
  }

  async function publicRequest(at) {
    const intent = await readIntent();
    if (!intent) return null;
    if (intent.status === 'pending' && Date.parse(intent.expiresAt) <= at) {
      // Lazy expiry under the shared lock; re-verified inside, so a racing
      // native pickup (id/rev/status change) wins. Lock contention -> report
      // as-is; the native side enforces expiry independently before acting.
      try {
        return await withIntentLock(1000, async () => {
          const current = await readIntent();
          if (
            !current ||
            current.id !== intent.id ||
            current.rev !== intent.rev ||
            current.status !== 'pending' ||
            Date.parse(current.expiresAt) > now()
          )
            return current || intent;
          const stamped = now();
          const expired = {
            ...current,
            rev: current.rev + 1,
            status: 'expired',
            statusAt: new Date(stamped).toISOString(),
            detail: 'expired',
          };
          await writeJsonAtomic(intentFile, expired);
          return expired;
        });
      } catch {
        return intent;
      }
    }
    return intent;
  }

  async function metadata({ force = false } = {}) {
    const at = now();
    const [pub, beat, req] = await Promise.all([
      fetchPublished({ force }),
      readHeartbeat(at),
      publicRequest(at),
    ]);
    return {
      installed: installedVersion,
      published: pub ? { version: pub.version, notes: pub.notes } : null,
      checkedAt: new Date(pub?.fetchedAt ?? at).toISOString(),
      stale: Boolean(pub && at - pub.fetchedAt >= METADATA_TTL_MS),
      metaError,
      desktop: beat,
      request: req
        ? {
            id: req.id,
            version: req.version,
            status: req.status,
            requestedAt: req.requestedAt,
            expiresAt: req.expiresAt,
            statusAt: req.statusAt,
            // Native-written free text, bounded for UI display.
            detail: String(req.detail || '').slice(0, 500),
          }
        : null,
    };
  }

  async function requestUpdate(body) {
    const at = now();
    if (
      !body ||
      Object.keys(body).some((key) => !['version', 'restartServer', 'confirmed'].includes(key)) ||
      body.confirmed !== true ||
      typeof body.restartServer !== 'boolean' ||
      !parseSemver(body.version)
    )
      throw new HttpError(400, tr('server.demande_de_mise_a_jour_invalide'));
    const pub = await fetchPublished();
    if (!pub)
      throw new HttpError(503, metaError || tr('server.mise_a_jour_indisponible_verifiez_votre_connexion'));
    // Strictly newer only: no reinstall, no downgrade.
    if (compareSemver(pub.version, installedVersion) !== 1)
      throw new HttpError(409, tr('server.application_deja_a_jour'));
    // Pinned to the cached published version: no arbitrary versions.
    if (body.version !== pub.version) throw new HttpError(409, tr('server.version_obsolete_reactualisez'));
    const beat = await readHeartbeat(at);
    if (!beat.alive) throw new HttpError(503, tr('server.application_de_bureau_hors_ligne'));
    // Refuse immediately on any active run: no surprise deferred auto-install.
    const active = await getActiveRuns();
    if (active > 0) throw new HttpError(409, tr('server.agents_en_cours_reessayez_plus_tard'));
    // Create under the shared lock: the live-intent re-check and the write are
    // one critical section, so concurrent POSTs cannot orphan each other.
    // Lock wait is bounded for HTTP latency; contention reports already-busy.
    // activeRunsAtRequest records the real count (always 0 here: any active
    // run was already refused above); kept for native-side audit.
    try {
      return await withIntentLock(5000, async () => {
        const existing = await readIntent();
        if (isLive(existing, now())) throw new HttpError(409, tr('server.demande_deja_en_cours'));
        // Explicit rate limit on actual creates: 30 s between requests, 10 per
        // rolling hour. In-memory only: it resets on server restart (documented;
        // gateway authentication still applies after restart).
        const stamp = now();
        while (createdAt.length && stamp - createdAt[0] > 3600000) createdAt.shift();
        if (createdAt.length >= 10 || (createdAt.length && stamp - createdAt[createdAt.length - 1] < 30000))
          throw new HttpError(429, tr('server.trop_de_demandes_de_mise_a_jour_patientez'));
        const requestedAt = new Date(stamp).toISOString();
        const intent = {
          schema: 1,
          id: randomUUID(),
          rev: 0,
          version: body.version,
          restartServer: body.restartServer,
          requestedAt,
          expiresAt: new Date(stamp + REQUEST_TTL_MS).toISOString(),
          activeRunsAtRequest: active,
          status: 'pending',
          statusAt: requestedAt,
          detail: '',
        };
        await writeJsonAtomic(intentFile, intent);
        createdAt.push(stamp);
        return { queued: true, id: intent.id, version: intent.version, expiresAt: intent.expiresAt };
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, tr('server.demande_deja_en_cours'));
    }
  }

  return { metadata, requestUpdate, UPDATER_META_URL, METADATA_TTL_MS, REQUEST_TTL_MS };
}
