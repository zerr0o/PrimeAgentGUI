import { formatMessage as tr } from '../public/i18n-core.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentEnvironment } from './agent.mjs';
import { HttpError } from './store.mjs';
import { credentialRevision, providerId } from './provider-auth.mjs';
const worker = join(dirname(fileURLToPath(import.meta.url)), '../scripts/provider-auth-worker.mjs');
const terminal = (job) => ['complete', 'error', 'cancelled'].includes(job.status);
const text = (value, limit = 2000) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, limit) : '';
export function createProviderService({
  agentHome,
  environment = process.env,
  spawnProcess = spawn,
  isBusy = () => false,
  onChanged = () => {},
  timeoutMs = 300000,
}) {
  const jobs = new Map(),
    operations = new Set(),
    locks = new Set();
  let closed = false;
  function open() {
    if (closed) throw new HttpError(503, tr('server.la_gestion_des_fournisseurs_est_en_cours_de_fermeture'));
  }
  function validate(body) {
    providerId(body.provider);
    if (typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision))
      throw new HttpError(400, tr('server.actualisez_la_liste_des_fournisseurs'));
  }
  function checkBusy(body, operation, replacing = false) {
    if ((replacing || operation === 'remove' || body.revision !== credentialRevision(null)) && isBusy())
      throw new HttpError(409, tr('server.attendez_la_fin_des_executions_du_studio_pour_remplacer_ou_retir'));
  }
  function launch() {
    open();
    const child = spawnProcess(process.execPath, [worker], {
      env: agentEnvironment({ agentHome, env: environment }),
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    child.stdin.on('error', () => {});
    operations.add(child);
    child.once('close', () => operations.delete(child));
    return child;
  }
  function read(child, receive, fail) {
    let buffer = '',
      total = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      total += chunk.length;
      buffer += chunk;
      if (total > 1024 * 1024)
        return fail(new HttpError(502, tr('server.reponse_du_fournisseur_trop_volumineuse')));
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          receive(JSON.parse(line));
        } catch (error) {
          fail(error.status ? error : new HttpError(502, tr('server.reponse_du_fournisseur_invalide')));
        }
      }
    });
    child.once('error', () => fail(new HttpError(502, tr('server.impossible_de_demarrer_la_connexion'))));
    child.once('close', () => fail(new HttpError(502, tr('server.la_connexion_a_ete_interrompue'))));
  }
  function errorFrom(data) {
    return new HttpError(
      [400, 404, 409, 429, 500, 502, 503].includes(data.status) ? data.status : 502,
      text(data.error) || tr('server.connexion_impossible'),
    );
  }
  async function request(operation, body = {}) {
    open();
    if (operation !== 'list') {
      validate(body);
      checkBusy(body, operation);
      if (locks.has(body.provider))
        throw new HttpError(409, tr('server.une_modification_de_ce_fournisseur_est_deja_en_cours'));
      locks.add(body.provider);
    }
    try {
      if (operations.size >= 4)
        throw new HttpError(429, tr('server.patientez_pendant_le_chargement_des_fournisseurs'));
      return await new Promise((resolve, reject) => {
        const child = launch();
        let settled = false;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.kill();
          if (error) reject(error);
          else {
            if (operation !== 'list') onChanged();
            resolve(result);
          }
        };
        const timer = setTimeout(
          () => finish(new HttpError(504, tr('server.le_chargement_a_expire_reessayez'))),
          20000,
        );
        read(
          child,
          (data) => {
            if (data.type === 'prompt' && data.prompt?.kind === 'commit' && operation !== 'list') {
              checkBusy(body, operation, data.prompt.replacing === true);
              child.stdin.write(JSON.stringify({ type: 'answer', id: data.prompt.id, value: true }) + '\n');
            } else if (data.type === 'result') finish(null, data.result);
            else if (data.type === 'error') finish(errorFrom(data));
          },
          finish,
        );
        child.stdin.write(JSON.stringify({ agentHome, operation, body }) + '\n');
      });
    } finally {
      if (operation !== 'list') locks.delete(body.provider);
    }
  }
  function snapshot(job) {
    return {
      id: job.id,
      provider: job.provider,
      status: job.status,
      url: job.url,
      instructions: job.instructions,
      prompts: [...job.prompts.values()],
      error: job.error,
    };
  }
  function finish(job, status, error) {
    if (terminal(job)) return;
    job.status = status;
    job.error = error;
    job.url = undefined;
    job.instructions = undefined;
    job.prompts.clear();
    clearTimeout(job.timer);
    locks.delete(job.provider);
    job.child.kill();
    job.expiry = setTimeout(() => jobs.delete(job.id), 60000);
    job.expiry.unref();
    if (status === 'complete') onChanged();
  }
  function login(body) {
    open();
    validate(body);
    checkBusy(body, 'login');
    if (locks.has(body.provider))
      throw new HttpError(409, tr('server.une_connexion_a_ce_fournisseur_est_deja_en_cours'));
    if ([...jobs.values()].some((job) => !terminal(job)))
      throw new HttpError(
        409,
        tr('server.terminez_ou_annulez_la_connexion_en_cours_avant_d_en_ouvrir_une_a'),
      );
    const child = launch();
    const job = { id: randomUUID(), provider: body.provider, status: 'preparing', child, prompts: new Map() };
    jobs.set(job.id, job);
    locks.add(body.provider);
    job.timer = setTimeout(
      () => finish(job, 'error', tr('server.connexion_expiree_relancez_la_pour_reessayer')),
      timeoutMs,
    );
    read(
      child,
      (data) => {
        if (terminal(job)) return;
        if (data.type === 'error') return finish(job, 'error', errorFrom(data).message);
        if (data.type === 'result') return finish(job, 'complete');
        if (data.type === 'auth') {
          const url = new URL(data.url);
          if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 16000)
            throw new Error('URL');
          job.url = url.href;
          job.instructions = text(data.instructions);
          job.status = 'waiting';
        } else if (data.type === 'prompt') {
          const prompt = data.prompt;
          if (!/^[a-f0-9-]{36}$/.test(prompt.id)) throw new Error('Prompt');
          if (prompt.kind === 'commit') {
            try {
              checkBusy(body, 'login', prompt.replacing === true);
            } catch (error) {
              finish(job, 'error', error.message);
              return;
            }
            child.stdin.write(JSON.stringify({ type: 'answer', id: prompt.id, value: true }) + '\n');
            job.status = 'saving';
            job.url = undefined;
            job.prompts.clear();
            return;
          }
          if (!['manual', 'text', 'select'].includes(prompt.kind) || job.prompts.size >= 8)
            throw new Error('Prompt');
          const safe = {
            id: prompt.id,
            kind: prompt.kind,
            message: text(prompt.message),
            placeholder: text(prompt.placeholder, 200),
            allowEmpty: prompt.allowEmpty === true,
          };
          if (prompt.kind === 'select') {
            if (!Array.isArray(prompt.options) || prompt.options.length > 100) throw new Error('Options');
            safe.options = prompt.options.map((option) => ({
              id: text(option.id, 200),
              label: text(option.label, 200),
            }));
          }
          job.prompts.set(safe.id, safe);
          job.status = 'waiting';
        }
      },
      (error) => finish(job, 'error', error.message),
    );
    child.stdin.write(JSON.stringify({ agentHome, operation: 'login', body }) + '\n');
    return snapshot(job);
  }
  function find(id) {
    const job = jobs.get(id);
    if (!job) throw new HttpError(404, tr('server.connexion_introuvable_ou_expiree'));
    return job;
  }
  // Minimal safe Codex linkage metadata for mobile/remote quota.
  // No secrets, no full provider list. Only linked flag + revision hash.
  // Sanitized here as well: worker must never return credentials.
  async function codexLink() {
    open();
    if (operations.size >= 4)
      throw new HttpError(429, tr('server.patientez_pendant_le_chargement_des_fournisseurs'));
    const result = await new Promise((resolve, reject) => {
      const child = launch();
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(
        () => finish(new HttpError(504, tr('server.le_chargement_a_expire_reessayez'))),
        20000,
      );
      read(
        child,
        (data) => {
          if (data.type === 'result') finish(null, data.result);
          else if (data.type === 'error') finish(errorFrom(data));
        },
        finish,
      );
      child.stdin.write(JSON.stringify({ agentHome, operation: 'codex_link', body: {} }) + '\n');
    });
    const revision =
      result && typeof result.revision === 'string' && /^[a-f0-9]{64}$/.test(result.revision)
        ? result.revision
        : null;
    if (!result || result.provider !== 'openai-codex' || !revision)
      throw new HttpError(502, tr('server.reponse_du_fournisseur_invalide'));
    return { provider: 'openai-codex', linked: result.linked === true, revision };
  }
  // Explicit public snapshot allowlist: only intended usage fields with bounds.
  // Enforced here even though the worker source is currently safe.
  function sanitizeCodexUsageSnapshot(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const available = source.available === true;
    const fetchedAt =
      typeof source.fetchedAt === 'number' && Number.isFinite(source.fetchedAt) && source.fetchedAt > 0
        ? Math.round(source.fetchedAt)
        : Date.now();
    if (!available) {
      const reason = ['unlinked', 'auth', 'unavailable'].includes(source.reason) ? source.reason : 'unavailable';
      return { available: false, reason, provider: 'openai-codex', fetchedAt, cached: false };
    }
    const cleanText = (text, limit) =>
      typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || undefined : undefined;
    const cleanWindow = (window) => {
      if (!window || typeof window !== 'object' || Array.isArray(window)) return null;
      const used = typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent)
        ? Math.min(100, Math.max(0, Math.round(window.usedPercent * 10) / 10))
        : undefined;
      const remaining = typeof window.remainingPercent === 'number' && Number.isFinite(window.remainingPercent)
        ? Math.min(100, Math.max(0, Math.round(window.remainingPercent)))
        : undefined;
      const resetAt =
        typeof window.resetAt === 'number' && Number.isFinite(window.resetAt) && window.resetAt > 0
          ? Math.round(window.resetAt)
          : undefined;
      if (used === undefined || remaining === undefined || resetAt === undefined) return null;
      const windowSeconds =
        typeof window.windowSeconds === 'number' &&
        Number.isFinite(window.windowSeconds) &&
        window.windowSeconds > 0 &&
        window.windowSeconds <= 366 * 24 * 60 * 60
          ? Math.round(window.windowSeconds)
          : undefined;
      return { usedPercent: used, remainingPercent: remaining, resetAt, ...(windowSeconds !== undefined ? { windowSeconds } : {}) };
    };
    const creditsSource = source.credits && typeof source.credits === 'object' && !Array.isArray(source.credits) ? source.credits : {};
    const credits = {
      ...(typeof creditsSource.hasCredits === 'boolean' ? { hasCredits: creditsSource.hasCredits } : {}),
      ...(typeof creditsSource.unlimited === 'boolean' ? { unlimited: creditsSource.unlimited } : {}),
      ...(typeof creditsSource.balance === 'string' || typeof creditsSource.balance === 'number'
        ? (() => {
            const balance = String(creditsSource.balance).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);
            return balance ? { balance } : {};
          })()
        : {}),
    };
    const plan = cleanText(source.plan, 80);
    const short = cleanWindow(source.short);
    const weekly = cleanWindow(source.weekly);
    if (!short && !weekly) return { available: false, reason: 'unavailable', provider: 'openai-codex', fetchedAt, cached: false };
    return {
      available: true,
      provider: 'openai-codex',
      ...(plan !== undefined ? { plan } : {}),
      ...(typeof source.limitReached === 'boolean' ? { limitReached: source.limitReached } : {}),
      short,
      weekly,
      ...(Object.keys(credits).length ? { credits } : {}),
      fetchedAt,
      cached: false,
    };
  }
  // Read-only Codex quota cache: bounded, credential-aware (revision key), short TTL.
  // No secrets are stored here; worker returns only public snapshot fields.
  const codexUsageCache = new Map();
  const CODEX_USAGE_TTL_MS = 60 * 1000;
  const CODEX_USAGE_CACHE_MAX = 4;
  const codexUsageInflight = new Map();
  function codexUsageCached(body) {
    open();
    providerId(body.provider);
    if (body.provider !== 'openai-codex') throw new HttpError(400, tr('server.fournisseur_invalide'));
    if (typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision))
      throw new HttpError(400, tr('server.actualisez_la_liste_des_fournisseurs'));
    const now = Date.now();
    const hit = codexUsageCache.get(body.revision);
    if (hit && now - hit.at < CODEX_USAGE_TTL_MS) return Promise.resolve({ ...hit.result, cached: true });
    if (codexUsageInflight.has(body.revision)) return codexUsageInflight.get(body.revision);
    const pending = (async () => {
      if (operations.size >= 4)
        throw new HttpError(429, tr('server.patientez_pendant_le_chargement_des_fournisseurs'));
      const result = await new Promise((resolve, reject) => {
        const child = launch();
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.kill();
          if (error) reject(error);
          else resolve(value);
        };
        const timer = setTimeout(
          () => finish(new HttpError(504, tr('server.le_chargement_a_expire_reessayez'))),
          20000,
        );
        read(
          child,
          (data) => {
            if (data.type === 'result') finish(null, data.result);
            else if (data.type === 'error') finish(errorFrom(data));
          },
          finish,
        );
        child.stdin.write(JSON.stringify({ agentHome, operation: 'codex_usage', body }) + '\n');
      });
      // Explicit public allowlist boundary before caching/return. Never forward raw worker fields.
      const safe = sanitizeCodexUsageSnapshot(result);
      if (codexUsageCache.size >= CODEX_USAGE_CACHE_MAX) codexUsageCache.delete(codexUsageCache.keys().next().value);
      codexUsageCache.set(body.revision, { result: { ...safe, cached: false }, at: Date.now() });
      return { ...safe, cached: false };
    })().finally(() => codexUsageInflight.delete(body.revision));
    codexUsageInflight.set(body.revision, pending);
    return pending;
  }
  return {
    list: async () => ({
      ...(await request('list')),
      busy: isBusy(),
      activeLogin: [...jobs.values()].find((job) => !terminal(job))?.id || null,
    }),
    save: (body) => request('save', body),
    remove: (body) => request('remove', body),
    codexLink: () => codexLink(),
    codexUsage: (body) => codexUsageCached(body),
    login,
    job: (id) => snapshot(find(id)),
    answer(id, body) {
      const job = find(id),
        prompt = job.prompts.get(body.promptId);
      if (terminal(job) || !prompt)
        throw new HttpError(409, tr('server.cette_etape_de_connexion_n_attend_plus_de_reponse'));
      if (
        typeof body.value !== 'string' ||
        body.value.length > 16000 ||
        (!body.value.trim() && !prompt.allowEmpty) ||
        /[\u0000-\u001f\u007f]/.test(body.value)
      )
        throw new HttpError(400, tr('server.saisissez_une_reponse_valide'));
      if (prompt.kind === 'select' && !prompt.options.some((option) => option.id === body.value))
        throw new HttpError(400, tr('server.choix_invalide'));
      job.child.stdin.write(
        JSON.stringify({ type: 'answer', id: prompt.id, value: body.value.trim() }) + '\n',
      );
      job.prompts.delete(body.promptId);
      return snapshot(job);
    },
    cancel(id) {
      const job = find(id);
      if (job.status === 'saving')
        throw new HttpError(409, tr('server.enregistrement_en_cours_patientez_un_instant'));
      finish(job, 'cancelled');
      return snapshot(job);
    },
    close() {
      closed = true;
      for (const job of jobs.values()) {
        clearTimeout(job.timer);
        clearTimeout(job.expiry);
      }
      for (const child of operations) child.kill();
    },
  };
}
