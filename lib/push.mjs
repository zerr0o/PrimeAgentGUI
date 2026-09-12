// Mobile PWA Web Push service (VAPID).
// Conservative defaults: per-device opt-in, generic payload only, vendor allowlist,
// ownership tokens, no endpoint/auth logging, no enumeration.
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const PUSH_MAX_SUBSCRIPTIONS = 30;
export const PUSH_FOCUS_LEASE_MS = 30 * 1000;
const PAYLOAD_LIMIT = 2000;
const ENDPOINT_LIMIT = 2048;

// Recognized browser-vendor push relays only. HTTPS alone is not enough.
// Exact hosts plus the Apple suffix below. No custom hosts, no IPs, no ports.
const PUSH_ALLOWED_EXACT = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);
const PUSH_ALLOWED_SUFFIX = '.push.apple.com';

const B64URL = /^[A-Za-z0-9_-]+$/;
// Safe encoded IDs for click-through navigation (same shape as store validId).
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

function bad(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function isPushEndpointAllowed(endpoint) {
  try {
    if (typeof endpoint !== 'string' || !endpoint || endpoint.length > ENDPOINT_LIMIT) return false;
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    // Forbid custom/local endpoints: only default 443, no explicit port.
    if (url.port) return false;
    const host = url.hostname.toLowerCase();
    if (!host || host.length > 253) return false;
    if (isIP(host) !== 0) return false;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return false;
    if (PUSH_ALLOWED_EXACT.has(host)) return true;
    if (host.endsWith(PUSH_ALLOWED_SUFFIX) && host.length > PUSH_ALLOWED_SUFFIX.length) return true;
    return false;
  } catch {
    return false;
  }
}

function checkKey(value, minDecoded, maxDecoded, name) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200 || !B64URL.test(value))
    throw bad(400, `push.invalid_${name}`);
  let decoded;
  try {
    const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
    decoded = Buffer.from(padded.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
  } catch {
    throw bad(400, `push.invalid_${name}`);
  }
  if (decoded.length < minDecoded || decoded.length > maxDecoded) throw bad(400, `push.invalid_${name}`);
  return value;
}

function checkIds(sessionId, runId) {
  for (const [value, name] of [
    [sessionId, 'session'],
    [runId, 'run'],
  ]) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !SAFE_ID.test(value)) throw bad(400, `push.invalid_${name}_id`);
  }
}

function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function sameHash(aHex, bHex) {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function writeAtomic(file, text) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await mkdir(join(file, '..'), { recursive: true }).catch(() => {});
  await writeFile(tmp, text, { flag: 'wx', mode: 0o600 });
  await rename(tmp, file);
}

export function createPushService({ dataDir, sendFn, now = () => Date.now() } = {}) {
  const vapidFile = join(dataDir, 'push-vapid.json');
  const subsFile = join(dataDir, 'push-subscriptions.json');
  let vapid = null;
  let subs = [];
  let loaded = false;
  let webpush = null;

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = await readFile(vapidFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.publicKey === 'string' &&
        typeof parsed.privateKey === 'string' &&
        B64URL.test(parsed.publicKey) &&
        B64URL.test(parsed.privateKey)
      ) {
        vapid = parsed;
        // Apple push rejects localhost VAPID contacts (BadJwtToken). Migrate to the
        // public project URL; web-push accepts mailto: or https:// subjects.
        if (typeof vapid.subject !== 'string' || vapid.subject.includes('localhost'))
          vapid.subject = 'https://github.com/zerr0o/prime-agent-studio';
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('push vapid read failed');
    }
    try {
      const raw = await readFile(subsFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.subs)) subs = parsed.subs.filter((s) => s && typeof s === 'object');
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('push subscriptions read failed');
    }
    // Drop anything that no longer passes the allowlist (defense in depth).
    const before = subs.length;
    subs = subs.filter((s) => typeof s.endpoint === 'string' && isPushEndpointAllowed(s.endpoint));
    if (subs.length !== before) await persist().catch(() => {});
  }

  async function persist() {
    try {
      await mkdir(dataDir, { recursive: true });
      await writeAtomic(subsFile, JSON.stringify({ subs }, null, 2) + '\n');
    } catch {
      // Persistence failure must not break agent runs; push is best-effort.
    }
  }

  async function ensureVapid() {
    await load();
    if (vapid) return vapid;
    // Use web-push key generation via project dependency; never handroll P-256.
    try {
      const mod = await import('web-push');
      const keys = mod.default?.generateVAPIDKeys?.() || mod.generateVAPIDKeys?.();
      if (!keys?.publicKey || !keys?.privateKey) throw new Error('vapid generation failed');
      vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'https://github.com/zerr0o/prime-agent-studio' };
    } catch {
      throw bad(503, 'push.unavailable');
    }
    try {
      await mkdir(dataDir, { recursive: true });
      await writeAtomic(vapidFile, JSON.stringify(vapid, null, 2) + '\n');
    } catch {}
    return vapid;
  }

  async function sender() {
    if (sendFn) return sendFn;
    if (webpush) return webpush;
    await ensureVapid();
    try {
      const mod = await import('web-push');
      const lib = mod.default || mod;
      lib.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      webpush = async (sub, payload) => {
        // Re-check allowlist at send time; never follow custom endpoints.
        if (!isPushEndpointAllowed(sub.endpoint)) throw bad(400, 'push.endpoint_not_allowed');
        await lib.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 24 * 3600, urgency: 'high' },
        );
      };
      return webpush;
    } catch {
      throw bad(503, 'push.unavailable');
    }
  }

  function findByEndpoint(endpoint) {
    return subs.find((s) => s.endpoint === endpoint);
  }

  function findById(id) {
    return subs.find((s) => s.id === id);
  }

  function checkToken(sub, token) {
    if (!sub || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw bad(401, 'push.unauthorized');
    if (!sameHash(sub.tokenHash, hashToken(token))) throw bad(401, 'push.unauthorized');
  }

  return {
    isPushEndpointAllowed,
    async publicKey() {
      const keys = await ensureVapid();
      return keys.publicKey;
    },
    async preferences(endpoint) {
      await load();
      if (typeof endpoint !== 'string' || !endpoint) throw bad(400, 'push.invalid_endpoint');
      const sub = findByEndpoint(endpoint);
      if (!sub) return { subscribed: false, questions: true, turnComplete: true };
      return { subscribed: true, questions: sub.questions !== false, turnComplete: sub.turnComplete !== false };
    },
    async subscribe({ endpoint, p256dh, auth, questions = true, turnComplete = true, token: proof }) {
      await load();
      if (!isPushEndpointAllowed(endpoint)) throw bad(400, 'push.endpoint_not_allowed');
      checkKey(p256dh, 64, 96, 'p256dh');
      checkKey(auth, 12, 32, 'auth');
      const wantQuestions = questions !== false;
      const wantComplete = turnComplete !== false;
      if (wantQuestions === false && wantComplete === false) throw bad(400, 'push.nothing_enabled');
      let sub = findByEndpoint(endpoint);
      if (sub) {
        // Existing endpoint: resubscribe requires the current ownership token.
        // Without proof, anyone holding the shared LAN code could take over the
        // registration and rotate its token. Lost tokens re-subscribe as a new
        // registration after explicit unsubscribe via settings (or expiry purge).
        checkToken(sub, proof);
        sub.p256dh = p256dh;
        sub.auth = auth;
        sub.questions = wantQuestions;
        sub.turnComplete = wantComplete;
        sub.updatedAt = now();
        // Rotate ownership token on verified re-subscribe.
        const token = randomBytes(32).toString('hex');
        sub.tokenHash = hashToken(token);
        await persist();
        return { id: sub.id, token };
      }
      if (subs.length >= PUSH_MAX_SUBSCRIPTIONS) throw bad(429, 'push.too_many_subscriptions');
      const token = randomBytes(32).toString('hex');
      sub = {
        id: randomUUID(),
        endpoint,
        p256dh,
        auth,
        questions: wantQuestions,
        turnComplete: wantComplete,
        tokenHash: hashToken(token),
        focusUntil: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      subs.push(sub);
      await persist();
      return { id: sub.id, token };
    },
    async update({ id, endpoint, token, questions, turnComplete }) {
      await load();
      const sub = id ? findById(id) : findByEndpoint(endpoint);
      if (!sub) throw bad(404, 'push.not_found');
      checkToken(sub, token);
      if (questions !== undefined) sub.questions = questions !== false;
      if (turnComplete !== undefined) sub.turnComplete = turnComplete !== false;
      if (sub.questions === false && sub.turnComplete === false) {
        subs = subs.filter((s) => s !== sub);
        await persist();
        return { removed: true };
      }
      sub.updatedAt = now();
      await persist();
      return { updated: true, questions: sub.questions, turnComplete: sub.turnComplete };
    },
    async unsubscribe({ id, endpoint, token }) {
      await load();
      const sub = id ? findById(id) : findByEndpoint(endpoint);
      if (!sub) return { removed: false };
      checkToken(sub, token);
      subs = subs.filter((s) => s !== sub);
      await persist();
      return { removed: true };
    },
    // Short-lived per-device focus lease. Best-effort foreground suppression happens
    // BEFORE send; the service worker always shows an incoming push (userVisibleOnly).
    async focus({ endpoint, id, token, focused }) {
      await load();
      const sub = id ? findById(id) : findByEndpoint(endpoint);
      if (!sub) throw bad(404, 'push.not_found');
      checkToken(sub, token);
      const t = now();
      sub.focusUntil = focused ? t + PUSH_FOCUS_LEASE_MS : 0;
      sub.updatedAt = t;
      await persist();
      return { focused: !!focused, until: sub.focusUntil };
    },
    // kind: 'question' | 'turnComplete'. Generic payload only, no project/prompt snippets.
    async notify(kind, { sessionId, runId } = {}) {
      await load();
      if (kind !== 'question' && kind !== 'turnComplete') return { sent: 0, skipped: 0 };
      checkIds(sessionId, runId);
      const t = now();
      const targets = subs.filter((s) =>
        kind === 'question' ? s.questions !== false : s.turnComplete !== false,
      );
      if (!targets.length) return { sent: 0, skipped: 0 };
      const payload = JSON.stringify({
        v: 1,
        kind,
        ...(sessionId ? { sessionId } : {}),
        ...(runId ? { runId } : {}),
      });
      if (payload.length > PAYLOAD_LIMIT) return { sent: 0, skipped: targets.length };
      let send;
      try {
        send = await sender();
      } catch {
        return { sent: 0, skipped: targets.length };
      }
      let sent = 0;
      let skipped = 0;
      const dead = [];
      for (const sub of targets) {
        // Best-effort: skip devices that recently reported a focused PWA.
        if (sub.focusUntil && sub.focusUntil > t) {
          skipped++;
          continue;
        }
        try {
          await send(sub, payload);
          sent++;
        } catch (error) {
          const status = error?.statusCode || error?.status;
          if (status === 404 || status === 410) dead.push(sub);
          else skipped++;
        }
      }
      if (dead.length) {
        subs = subs.filter((s) => !dead.includes(s));
        await persist();
      }
      return { sent, skipped };
    },
  };
}
