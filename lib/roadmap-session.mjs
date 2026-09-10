import { basename, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cwdKey, HttpError, validId } from './store.mjs';
import { readRoadmapSessionHeader } from './roadmap-bridge.mjs';

const missing = () =>
  Object.assign(new HttpError(404, 'Cette conversation est introuvable dans ce projet.'), {
    code: 'roadmap_session_missing',
  });

/** Resolve a durable Roadmap reference without opening, resuming or waking an agent. */
export function createRoadmapSessionResolver({ store, agentHome, sessionDir, readEdges }) {
  let ledger;
  const nativeEdges =
    readEdges ||
    (async () => {
      if (!ledger) {
        const { discoverCli } = await import('./agent.mjs');
        const cli = discoverCli();
        if (!cli?.packageDir) throw missing();
        const { RlmSpawnLedger } = await import(
          pathToFileURL(join(cli.packageDir, 'dist/modes/daemon/rlm-ledger.js')).href
        );
        ledger = new RlmSpawnLedger(agentHome, sessionDir);
      }
      return ledger.liveEdges();
    });
  return async ({ cwd, sessionId, rootSessionId }) => {
    if (!validId(sessionId) || (rootSessionId !== undefined && !validId(rootSessionId)))
      throw new HttpError(400, 'La référence de conversation est invalide.');
    const project = await store.findProject(cwd);
    const ownProject = (value) => value?.cwd && cwdKey(value.cwd) === cwdKey(project.cwd);
    let rootHint;
    if (rootSessionId) {
      rootHint = await store.history(rootSessionId).catch(() => null);
      if (!ownProject(rootHint)) throw missing();
    }
    const direct = await store.history(sessionId).catch(() => null);
    if (direct) {
      if (!ownProject(direct) || (rootHint && rootHint.id !== sessionId)) throw missing();
      return { sessionId, rootSessionId: sessionId };
    }
    const roots = [sessionDir, join(agentHome, 'session-artifacts')];
    const entries = (await nativeEdges()).filter(
      (edge) =>
        !edge.deleted &&
        validId(edge.childId) &&
        isAbsolute(edge.child || '') &&
        isAbsolute(edge.parent || ''),
    );
    const byChild = new Map();
    for (const edge of entries) {
      const key = cwdKey(edge.child);
      if (byChild.has(key)) throw missing();
      byChild.set(key, edge);
    }
    // Native 0.9.4 uses the persisted session ID as filename. It is only a
    // lookup hint: a matching file still needs its header and lineage checked.
    const hinted = entries.filter((edge) => basename(edge.child).includes(sessionId));
    const candidates = hinted.length ? hinted : entries;
    if (candidates.length > 2000)
      throw Object.assign(
        new HttpError(413, 'Trop de délégations à parcourir. Ouvrez la conversation depuis son projet.'),
        { code: 'roadmap_session_limit' },
      );
    const matches = [];
    for (const edge of candidates) {
      let header;
      try {
        header = await readRoadmapSessionHeader(edge.child, roots);
      } catch {
        continue;
      }
      if (header.id === sessionId && ownProject(header)) matches.push({ header, edge });
    }
    if (matches.length !== 1) throw missing();
    let { header, edge } = matches[0];
    const agentId = edge.childId;
    const visited = new Set();
    for (let depth = 0; depth < 32; depth++) {
      const key = cwdKey(header.file);
      if (visited.has(key)) throw missing();
      visited.add(key);
      edge = byChild.get(key);
      if (!edge) {
        const root = rootHint || (await store.history(header.id).catch(() => null));
        if (!ownProject(root) || root.id !== header.id || cwdKey(root.file) !== cwdKey(header.file))
          throw missing();
        return { sessionId, rootSessionId: root.id, agentId };
      }
      try {
        header = await readRoadmapSessionHeader(edge.parent, roots);
      } catch {
        throw missing();
      }
      if (!ownProject(header)) throw missing();
    }
    throw missing();
  };
}
