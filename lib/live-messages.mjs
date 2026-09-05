import { createHash } from 'node:crypto';
import { HttpError, cwdKey, validId } from './store.mjs';

const lanes = new Set(['steering', 'followUp']);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
function messageText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'Le message est vide.');
  if (Buffer.byteLength(value) > 256 * 1024) throw new HttpError(413, 'Le message dépasse 256 Ko.');
  return value;
}

/** Admission and retry protection for an active execution of a native session. */
export function createLiveMessages({ getRuns, getClient, now = Date.now }) {
  const requests = new Map();
  async function target(sessionId, cwd, writing = false) {
    if (!validId(sessionId) || typeof cwd !== 'string' || !cwd)
      throw new HttpError(400, 'Session ou projet invalide.');
    // Completed runs remain in the server's replay history. They must never
    // shadow a later execution of the same native session.
    const run = (await getRuns()).find((r) =>
      r.sessionId === sessionId && cwdKey(r.cwd) === cwdKey(cwd) &&
      ['running', 'stopping'].includes(r.status));
    if (!run) {
      if (writing) throw new HttpError(409, 'Cette exécution est terminée. Votre brouillon est conservé.');
      return null;
    }
    if (writing && run.status !== 'running') throw new HttpError(409, 'L’agent est en cours d’arrêt.');
    const client = await getClient(run);
    if (!client) {
      if (writing) throw new HttpError(503, 'L’envoi pendant l’exécution est momentanément indisponible.');
      return null;
    }
    return { run, client };
  }
  const unavailable = () => ({ available: false, steering: [], followUps: [] });
  function snapshot(value) {
    return {
      available: value?.available !== false,
      steering: Array.isArray(value?.steering) ? value.steering : [],
      followUps: Array.isArray(value?.followUps) ? value.followUps : [],
    };
  }
  async function getSnapshot(sessionId, cwd) {
    const selected = await target(sessionId, cwd);
    if (!selected) return unavailable();
    try {
      return snapshot(await selected.client.getSnapshot(sessionId, cwd));
    } catch (error) {
      if ([404, 409, 503].includes(error.status)) return unavailable();
      throw error;
    }
  }
  function once(key, value, action) {
    for (const [id, entry] of requests) if (entry.expires <= now()) requests.delete(id);
    const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const previous = requests.get(key);
    if (previous) {
      if (previous.hash !== hash) throw new HttpError(409, 'Cet identifiant correspond à un autre envoi.');
      return previous.promise;
    }
    if (requests.size >= 2000)
      throw new HttpError(429, 'Trop de demandes. Réessayez dans quelques instants.');
    // Cache errors too: a timed-out native acceptance must never be blindly resubmitted.
    const promise = Promise.resolve().then(action);
    requests.set(key, { hash, promise, expires: now() + 60 * 60 * 1000 });
    return promise;
  }
  async function send(sessionId, body) {
    if (!object(body)) throw new HttpError(400, 'Demande invalide.');
    const message = messageText(body.message);
    if (!['steer', 'follow_up'].includes(body.mode)) throw new HttpError(400, 'Mode d’envoi invalide.');
    if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId))
      throw new HttpError(400, 'Identifiant d’envoi invalide.');
    if (!validId(sessionId) || typeof body.cwd !== 'string') throw new HttpError(400, 'Session invalide.');
    const value = { sessionId, cwd: cwdKey(body.cwd), message, mode: body.mode };
    return once(`${sessionId}:${body.requestId}`, value, async () => {
      const { client } = await target(sessionId, body.cwd, true);
      const result = await client.send(sessionId, body.cwd, {
        message,
        mode: body.mode,
        requestId: body.requestId,
      });
      if (result?.accepted !== true)
        throw new HttpError(409, 'Le message n’a pas été accepté. Votre brouillon est conservé.');
      return {
        accepted: true,
        requestId: body.requestId,
        ...(result?.snapshot ? snapshot(result.snapshot) : {}),
      };
    });
  }
  async function mutate(sessionId, body) {
    if (
      !object(body) ||
      !lanes.has(body.lane) ||
      !Number.isSafeInteger(body.index) ||
      body.index < 0 ||
      typeof body.expectedText !== 'string' ||
      !object(body.mutation)
    )
      throw new HttpError(400, 'Message en attente invalide.');
    const { mutation } = body;
    if (!['delete', 'move', 'replace'].includes(mutation.type))
      throw new HttpError(400, 'Modification invalide.');
    if (mutation.type === 'move' && ![-1, 1].includes(mutation.direction))
      throw new HttpError(400, 'Déplacement invalide.');
    if (mutation.type === 'replace') {
      messageText(mutation.text);
      if (!lanes.has(mutation.lane)) throw new HttpError(400, 'Mode d’envoi invalide.');
    }
    const { client } = await target(sessionId, body.cwd, true);
    const result = await client.mutate(sessionId, body.cwd, {
      lane: body.lane,
      index: body.index,
      expectedText: body.expectedText,
      mutation,
    });
    if (result?.status && result.status !== 'applied')
      throw new HttpError(409, 'La file a changé ou ce message a déjà été transmis. Actualisez-la.');
    return { status: 'applied', ...snapshot(result?.snapshot || result) };
  }
  return { getSnapshot, send, mutate };
}

export async function routeLiveMessages({ service, method, url, readBody }) {
  if (url.pathname === '/api/live/capabilities' && method === 'GET') return { available: true };
  const match = url.pathname.match(/^\/api\/live\/sessions\/([A-Za-z0-9_-]+)(?:\/(messages|queue))?$/);
  if (!match) throw new HttpError(404, 'Route introuvable.');
  if (method === 'GET' && !match[2]) return service.getSnapshot(match[1], url.searchParams.get('cwd'));
  if (method === 'POST' && match[2] === 'messages') return service.send(match[1], await readBody());
  if (method === 'POST' && match[2] === 'queue') return service.mutate(match[1], await readBody());
  throw new HttpError(405, 'Méthode non autorisée.');
}
