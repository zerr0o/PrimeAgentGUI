import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStore, HttpError, validateDirectory, cwdKey, validId } from './lib/store.mjs';
import { createAgentRuntime } from './lib/agent.mjs';
import { createLanGateway } from './lib/lan.mjs';
import { createModelConfigStore } from './lib/model-config.mjs';
import { createModelDefaultsStore } from './lib/model-defaults.mjs';
import { openDirectory } from './lib/open-directory.mjs';
import { createMcpService } from './lib/mcp-service.mjs';
import { createCommandService, parseCommand, validateCommand } from './lib/commands.mjs';
import { createLiveMessages, routeLiveMessages } from './lib/live-messages.mjs';
import { createLiveSessionClient } from './lib/live-session-client.mjs';
import { validateImages, imageBodyLimit } from './lib/images.mjs';
import { createFileStore, validateFiles, appendFileMessage, splitFileMessage } from './lib/files.mjs';
import { createProjectFiles } from './lib/project-files.mjs';
import { openFile as openLocalFile, fileLaunchMode } from './lib/open-file.mjs';
import { createSessionInspector } from './lib/session-inspector.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const VERSION = '2.1.0';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};
const publicRun = ({ id, sessionId, cwd, status, startedAt, endedAt, error, model, thinking, prompt }) => ({
  id,
  sessionId,
  cwd,
  status,
  startedAt,
  endedAt,
  error,
  model,
  thinking,
  prompt: splitFileMessage(prompt).text,
  attachments: splitFileMessage(prompt).attachments,
});

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
    throw new HttpError(415, 'Un corps JSON est requis.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > imageBodyLimit(req.url.split('?')[0]))
      throw new HttpError(413, 'La demande dépasse la taille autorisée.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    if (length > 512 * 1024 && !body.images?.length && !body.files?.length)
      throw new HttpError(413, 'La demande dépasse 512 Ko.');
    return body;
  } catch (error) {
    if (error.status) throw error;
    throw new HttpError(400, 'La demande JSON est invalide.');
  }
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function createApp(options = {}) {
  const agentHome =
    options.agentHome || process.env.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime', 'agent');
  const sessionDir = options.sessionDir || process.env.PRIME_AGENT_SESSION_DIR || join(agentHome, 'sessions');
  const dataDir = options.dataDir || process.env.PRIME_AGENT_GUI_DATA_DIR || join(ROOT, '.local');
  const store = options.store || createStore({ sessionDir, dataDir, initialCwd: options.initialCwd || ROOT });
  const fileStore = createFileStore(join(dataDir, 'attachments'));
  const runtime =
    options.runtime || createAgentRuntime({ agentHome, sessionDir, cliPath: process.env.PRIME_AGENT_CLI });
  const modelConfig = options.modelConfig || createModelConfigStore({ agentHome });
  const modelDefaults = options.modelDefaults || createModelDefaultsStore({ agentHome });
  const mcp = options.mcp || createMcpService({ agentHome });
  const runs = new Map(),
    sessionLocks = new Set();
  const projectFiles = createProjectFiles({ store, protectedRoots: [agentHome, sessionDir, dataDir] });
  const inspector = createSessionInspector({
    store,
    agentHome,
    sessionDir,
    getRun: (id) => [...runs.values()].findLast((run) => run.sessionId === id),
    getClient: () => {
      if (options.inspectorClient) return options.inspectorClient;
      const endpoint = runtime.getLiveEndpoint?.();
      return endpoint ? createLiveSessionClient(endpoint) : null;
    },
    readEdges: options.readInspectorEdges,
  });
  const commands =
    options.commands ||
    createCommandService({
      agentHome,
      getLiveClient: (sessionId, cwd) => {
        if (
          ![...runs.values()].some(
            (run) =>
              run.sessionId === sessionId && cwdKey(run.cwd) === cwdKey(cwd) && run.status === 'running',
          )
        )
          return null;
        const endpoint = runtime.getLiveEndpoint?.();
        return endpoint ? createLiveSessionClient(endpoint) : null;
      },
    });
  const liveMessages = createLiveMessages({
    fileStore,
    validateMessage: async (message, context) => {
      if (parseCommand(message))
        validateCommand(message, await commands.list(context), {
          live: true,
          attachments: context.attachments,
        });
    },
    getRuns: () => [...runs.values()],
    getClient: () => {
      if (options.liveClient) return options.liveClient;
      const endpoint = runtime.getLiveEndpoint?.();
      return endpoint ? createLiveSessionClient(endpoint) : null;
    },
  });
  let closing = false;
  let statusCache,
    modelCache,
    statusAt = 0,
    modelsAt = 0;
  async function status() {
    if (!statusCache || Date.now() - statusAt > 60000) {
      statusCache = Promise.resolve(runtime.getStatus());
      statusAt = Date.now();
    }
    return statusCache;
  }
  async function models() {
    if (!modelCache || Date.now() - modelsAt > 60000) {
      modelCache = Promise.resolve(runtime.getModels());
      modelsAt = Date.now();
    }
    return modelCache;
  }
  function invalidateModels() {
    modelCache = undefined;
    modelsAt = 0;
  }
  async function configuredModels(operation) {
    const configuration = await operation;
    invalidateModels();
    return { ...configuration, catalog: await models() };
  }
  async function setDefaultModel(body) {
    if (
      !body ||
      Object.keys(body).some((key) => key !== 'model') ||
      typeof body.model !== 'string' ||
      body.model.length > 500
    )
      throw new HttpError(400, 'Sélection de modèle invalide.');
    let selection = null;
    if (body.model) {
      const catalog = await models(),
        selected = catalog.models?.find((model) => model.id === body.model),
        prefix = selected ? `${selected.provider}/` : '';
      if (!selected || !selected.id.startsWith(prefix) || selected.id.length === prefix.length)
        throw new HttpError(400, 'Ce modèle n’est pas disponible dans Prime Agent.');
      selection = { provider: selected.provider, id: selected.id.slice(prefix.length) };
    }
    return configuredModels(modelDefaults.set(selection));
  }
  function activeRuns() {
    return [...runs.values()].filter((r) => r.status === 'running' || r.status === 'stopping').map(publicRun);
  }
  function pushEvent(run, event) {
    if (event.kind === 'session' && event.sessionId) {
      run.sessionId = event.sessionId;
      sessionLocks.add(event.sessionId);
    }
    if (event.kind === 'done') {
      if (run.finished) return;
      run.finished = true;
      run.status = event.status || ((event.code ?? 0) === 0 ? 'completed' : 'failed');
      run.error = event.error || null;
      run.endedAt = new Date().toISOString();
      if (run.sessionId) sessionLocks.delete(run.sessionId);
    }
    const item = { ...event, seq: ++run.seq };
    const wire = `id: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n`;
    run.events.push({ item, wire });
    run.bytes += Buffer.byteLength(wire);
    // Streaming output is bounded per execution; durable native history remains available.
    while (run.bytes > 16 * 1024 * 1024 && run.events.length > 1) {
      const removed = run.events.shift();
      run.bytes -= Buffer.byteLength(removed.wire);
    }
    for (const client of run.clients) {
      if (client.writableLength > 16 * 1024 * 1024) {
        client.destroy();
        run.clients.delete(client);
      } else client.write(wire);
    }
    if (run.finished) {
      for (const client of run.clients) client.end();
      run.clients.clear();
    }
  }
  async function startRun(body) {
    if (closing) throw new HttpError(503, 'Le serveur est en cours d’arrêt.');
    if (activeRuns().length >= 8)
      throw new HttpError(429, 'Huit sessions tournent déjà. Arrêtez-en une avant de continuer.');
    const cwd = await validateDirectory(body.cwd);
    const images = validateImages(body.images);
    const files = validateFiles(body.files);
    if (images.length + files.length > 8) throw new HttpError(400, 'Ajoutez au maximum 8 pièces jointes.');
    if (typeof body.message !== 'string' || (!body.message.trim() && !images.length && !files.length))
      throw new HttpError(400, 'Écrivez un message avant de l’envoyer.');
    if (body.message.length > 200000) throw new HttpError(400, 'Le message dépasse 200 000 caractères.');
    if (parseCommand(body.message))
      validateCommand(body.message, await commands.list({ cwd }), {
        attachments: images.length + files.length > 0,
      });
    if (images.length) {
      const catalog = await models();
      const selected = catalog.models?.find((model) => model.id === (body.model || catalog.default?.model));
      if (selected?.input && !selected.input.includes('image'))
        throw new HttpError(
          400,
          'Ce modèle ne prend pas en charge les images. Choisissez un modèle compatible.',
        );
    }
    if (
      body.model !== undefined &&
      (typeof body.model !== 'string' || body.model.length > 300 || /[\r\n\0]/.test(body.model))
    )
      throw new HttpError(400, 'Modèle invalide.');
    if (
      body.thinking != null &&
      body.thinking !== '' &&
      !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(body.thinking)
    )
      throw new HttpError(400, 'Niveau de réflexion invalide.');
    if (body.sessionId != null && body.sessionId !== '' && !validId(body.sessionId))
      throw new HttpError(400, 'Identifiant de session invalide.');
    let existing;
    if (body.sessionId) {
      existing = await store.history(body.sessionId);
      if (!existing.cwd || cwdKey(cwd) !== cwdKey(existing.cwd))
        throw new HttpError(409, 'Cette session appartient à un autre dossier.');
    }
    // Check after awaited validation so simultaneous HTTP requests cannot race the lock.
    if (activeRuns().length >= 8)
      throw new HttpError(429, 'Huit sessions tournent déjà. Arrêtez-en une avant de continuer.');
    if (existing && sessionLocks.has(existing.id)) throw new HttpError(409, 'Cette session travaille déjà.');
    if (existing) sessionLocks.add(existing.id);
    const run = {
      id: randomUUID(),
      sessionId: existing?.id || null,
      cwd,
      status: 'running',
      startedAt: new Date().toISOString(),
      model: body.model || null,
      thinking: body.thinking || null,
      prompt: body.message.trim() || 'Analyse les pièces jointes.',
      seq: 0,
      events: [],
      bytes: 0,
      clients: new Set(),
      finished: false,
    };
    runs.set(run.id, run);
    try {
      run.prompt = appendFileMessage(run.prompt, await fileStore.save(files));
      run.handle = await runtime.start({
        cwd,
        message: run.prompt,
        ...(images.length ? { images } : {}),
        sessionId: existing?.id,
        sessionFile: existing?.file,
        model: body.model || undefined,
        thinking: body.thinking || undefined,
        onEvent: (event) => pushEvent(run, event),
      });
      if (run.status === 'stopping') void run.handle.cancel();
      Promise.resolve(run.handle.done).then(
        (result) => {
          if (!run.finished)
            pushEvent(run, {
              kind: 'done',
              sessionId: run.sessionId,
              status: result?.status || 'completed',
              code: result?.code || 0,
              error: result?.error,
            });
        },
        (error) =>
          pushEvent(run, {
            kind: 'done',
            sessionId: run.sessionId,
            status: 'failed',
            code: -1,
            error: error.message,
          }),
      );
    } catch (error) {
      runs.delete(run.id);
      if (existing) sessionLocks.delete(existing.id);
      throw new HttpError(503, error.message);
    }
    return publicRun(run);
  }
  function subscribe(req, res, run, url) {
    let after = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0);
    if (!Number.isSafeInteger(after) || after < 0) after = 0;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    if (run.events[0]?.item.seq > after + 1)
      res.write(`data: ${JSON.stringify({ kind: 'replay_truncated', sessionId: run.sessionId })}\n\n`);
    for (const event of run.events) if (event.item.seq > after) res.write(event.wire);
    if (run.finished) {
      res.end();
      return;
    }
    run.clients.add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    heartbeat.unref();
    res.on('close', () => {
      clearInterval(heartbeat);
      run.clients.delete(res);
    });
  }
  const cleanup = setInterval(() => {
    for (const [id, run] of runs)
      if (run.finished && Date.now() - Date.parse(run.endedAt) > 3600000) runs.delete(id);
  }, 60000);
  cleanup.unref();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host))
        throw new HttpError(403, 'Hôte non autorisé.');
      if (req.headers.origin && req.headers.origin !== `http://${host}`)
        throw new HttpError(403, 'Origine non autorisée.');
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw new HttpError(403, 'Requête externe non autorisée.');
      const url = new URL(req.url, `http://${host}`),
        path = url.pathname,
        method = req.method;
      if (method === 'GET' && path === '/api/health')
        return json(res, 200, {
          service: 'prime-agent-gui',
          version: VERSION,
          pid: process.pid,
          status: 'ok',
          instanceId: process.env.PRIME_AGENT_GUI_INSTANCE || null,
        });
      if (method === 'GET' && path === '/api/bootstrap') {
        const [overview, version, catalog] = await Promise.all([store.overview(), status(), models()]);
        return json(res, 200, {
          ...overview,
          version,
          models: catalog,
          runs: activeRuns(),
          preferences: { attachments: true, inspector: true, nativeFileOpen: true },
        });
      }
      if (method === 'GET' && path === '/api/version') return json(res, 200, await status());
      if (method === 'GET' && path === '/api/models') return json(res, 200, await models());
      if (method === 'GET' && path === '/api/inspector')
        return json(
          res,
          200,
          await inspector.inspect(url.searchParams.get('cwd'), url.searchParams.get('sessionId')),
        );
      if (method === 'GET' && path === '/api/inspector/history')
        return json(
          res,
          200,
          await inspector.history(
            url.searchParams.get('cwd'),
            url.searchParams.get('sessionId'),
            url.searchParams.get('agentId'),
          ),
        );
      if (method === 'POST' && path === '/api/project-files/open') {
        const body = await readBody(req);
        const file = await projectFiles.localFile(body.cwd, body.path);
        fileLaunchMode(file);
        return json(res, 200, await (options.openFile || openLocalFile)(file));
      }
      if (method === 'GET' && path.startsWith('/api/project-files')) {
        const cwd = url.searchParams.get('cwd'),
          file = url.searchParams.get('path') || '';
        if (path === '/api/project-files')
          return json(
            res,
            200,
            await projectFiles.list(cwd, file, Number(url.searchParams.get('offset') || 0)),
          );
        if (path === '/api/project-files/changes') return json(res, 200, await projectFiles.changes(cwd));
        if (path === '/api/project-files/preview')
          return json(res, 200, await projectFiles.preview(cwd, file));
        if (path === '/api/project-files/resolve')
          return json(
            res,
            200,
            await projectFiles.resolveReference(
              cwd,
              url.searchParams.get('reference'),
              url.searchParams.get('basePath') || '',
            ),
          );
        if (path === '/api/project-files/diff') return json(res, 200, await projectFiles.diff(cwd, file));
        if (path === '/api/project-files/download') {
          const result = await projectFiles.download(cwd, file);
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': result.data.length,
            'Content-Disposition': `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(result.name.toWellFormed()).replace(/['()*]/g, (value) => '%' + value.charCodeAt(0).toString(16))}`,
            'Cache-Control': 'no-store',
          });
          return res.end(result.data);
        }
      }
      if (method === 'GET' && /^\/api\/files\/[a-f0-9-]+$/.test(path)) {
        const file = await fileStore.read(path.slice('/api/files/'.length));
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': file.data.length,
          'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.name.toWellFormed()).replace(/['()*]/g, (value) => '%' + value.charCodeAt(0).toString(16))}`,
          'Cache-Control': 'no-store',
        });
        res.end(file.data);
        return;
      }
      if (method === 'GET' && path === '/api/model-config') return json(res, 200, await modelConfig.list());
      if (path === '/api/commands' && method === 'GET')
        return json(
          res,
          200,
          await commands.list({
            cwd: url.searchParams.get('cwd'),
            sessionId: url.searchParams.get('sessionId') || undefined,
          }),
        );
      if (path === '/api/mcp' && method === 'GET') return json(res, 200, await mcp.list());
      if (path === '/api/mcp' && method === 'POST')
        return json(res, 200, await mcp.upsert(await readBody(req)));
      if (path === '/api/mcp' && method === 'PATCH')
        return json(res, 200, await mcp.toggle(await readBody(req)));
      if (path === '/api/mcp' && method === 'DELETE')
        return json(res, 200, await mcp.remove(await readBody(req)));
      if (path === '/api/mcp/test' && method === 'POST')
        return json(res, 200, await mcp.probe(await readBody(req)));
      if (path === '/api/mcp/login' && method === 'POST')
        return json(res, 200, await mcp.login(await readBody(req)));
      if (path === '/api/mcp/disconnect' && method === 'POST')
        return json(res, 200, await mcp.disconnect(await readBody(req)));
      if (path === '/api/mcp/login/complete' && method === 'POST')
        return json(res, 200, await mcp.complete(await readBody(req)));
      const mcpJob = path.match(/^\/api\/mcp\/login\/([a-f0-9-]{36})$/);
      if (mcpJob && method === 'GET') return json(res, 200, mcp.job(mcpJob[1]));
      if (mcpJob && method === 'DELETE') return json(res, 200, mcp.cancel(mcpJob[1]));
      if (method === 'GET' && path === '/api/model-defaults')
        return json(res, 200, await modelDefaults.get());
      if (method === 'POST' && path === '/api/model-defaults')
        return json(res, 200, await setDefaultModel(await readBody(req)));
      if (method === 'POST' && path === '/api/model-config')
        return json(res, 200, await configuredModels(modelConfig.upsert(await readBody(req))));
      if (method === 'DELETE' && path === '/api/model-config')
        return json(res, 200, await configuredModels(modelConfig.remove(await readBody(req))));
      if (path.startsWith('/api/live/'))
        return json(
          res,
          200,
          await routeLiveMessages({
            service: liveMessages,
            method,
            url,
            readBody: () => readBody(req),
          }),
        );
      if (method === 'GET' && path === '/api/overview')
        return json(res, 200, { ...(await store.overview()), runs: activeRuns() });
      if (method === 'GET' && path === '/api/history') {
        const { file, ...history } = await store.history(url.searchParams.get('id'));
        return json(res, 200, history);
      }
      if (method === 'GET' && path === '/api/check-cwd') {
        try {
          return json(res, 200, { cwd: await validateDirectory(url.searchParams.get('cwd')), exists: true });
        } catch {
          return json(res, 200, { cwd: url.searchParams.get('cwd'), exists: false });
        }
      }
      if ((method === 'POST' || method === 'PATCH') && path === '/api/projects')
        return json(
          res,
          method === 'POST' ? 201 : 200,
          await store.project(await readBody(req), method === 'PATCH'),
        );
      if (method === 'POST' && path === '/api/projects/open') {
        const project = await store.findProject((await readBody(req)).cwd);
        return json(res, 200, await (options.openDirectory || openDirectory)(project.cwd));
      }
      if (method === 'DELETE' && path === '/api/projects') {
        const project = await store.findProject((await readBody(req)).cwd);
        if (activeRuns().some((run) => cwdKey(run.cwd) === cwdKey(project.cwd)))
          throw new HttpError(409, 'Un agent travaille dans ce projet. Attendez sa fin avant de le retirer.');
        return json(res, 200, await store.removeProject(project.cwd));
      }
      if (method === 'PATCH' && path === '/api/sessions')
        return json(res, 200, await store.patchSession(await readBody(req)));
      if (method === 'GET' && path === '/api/runs') return json(res, 200, { runs: activeRuns() });
      if (method === 'POST' && path === '/api/runs')
        return json(res, 201, await startRun(await readBody(req)));
      const runRoute = path.match(/^\/api\/runs\/([a-f0-9-]+)\/(events|stop)$/);
      if (runRoute) {
        const run = runs.get(runRoute[1]);
        if (!run) throw new HttpError(404, 'Exécution introuvable. Rechargez son historique.');
        if (method === 'GET' && runRoute[2] === 'events') return subscribe(req, res, run, url);
        if (method === 'POST' && runRoute[2] === 'stop') {
          if (!run.finished) {
            run.status = 'stopping';
            await run.handle?.cancel();
          }
          return json(res, 200, { stopped: true, ...publicRun(run) });
        }
      }
      if (method === 'GET' || method === 'HEAD') {
        let file;
        if (path === '/' || path === '/index.html') file = join(ROOT, 'index.html');
        else if (path === '/vendor/marked.js')
          file = join(ROOT, 'node_modules', 'marked', 'lib', 'marked.esm.js');
        else if (path === '/vendor/purify.js')
          file = join(ROOT, 'node_modules', 'dompurify', 'dist', 'purify.es.mjs');
        else if (path === '/favicon.ico') file = join(ROOT, 'assets', 'prime-agent.ico');
        else if (path === '/manifest.webmanifest') file = join(ROOT, 'public', 'manifest.webmanifest');
        else if (path === '/service-worker.js') file = join(ROOT, 'public', 'service-worker.js');
        else if (path.startsWith('/public/')) {
          const base = resolve(ROOT, 'public');
          file = resolve(ROOT, '.' + decodeURIComponent(path));
          if (!file.startsWith(base + sep)) throw new HttpError(404, 'Fichier introuvable.');
        } else if (path.startsWith('/assets/')) {
          const base = resolve(ROOT, 'assets');
          file = resolve(ROOT, '.' + decodeURIComponent(path));
          if (!file.startsWith(base + sep)) throw new HttpError(404, 'Fichier introuvable.');
        }
        if (file) {
          if (!(await stat(file).catch(() => null))?.isFile())
            throw new HttpError(404, 'Fichier introuvable.');
          res.writeHead(200, {
            'Content-Type':
              MIME[extname(file)] ||
              (extname(file) === '.mjs' ? 'text/javascript; charset=utf-8' : 'application/octet-stream'),
            'Cache-Control': 'no-cache',
          });
          res.end(method === 'HEAD' ? undefined : await readFile(file));
          return;
        }
      }
      throw new HttpError(404, 'Route introuvable.');
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      json(res, error.status || 500, {
        error: error.status ? error.message : 'Une erreur interne est survenue. ' + error.message,
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  async function close() {
    mcp.close?.();
    commands.close?.();
    closing = true;
    clearInterval(cleanup);
    await runtime.close();
    for (const run of runs.values()) for (const client of run.clients) client.end();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
  return { server, store, runtime, modelConfig, modelDefaults, runs, close };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 3088);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT doit être compris entre 1 et 65535.');
  const app = createApp();
  const remoteServers = [];
  let shuttingDown = false;
  async function startLan() {
    try {
      const config = JSON.parse(await readFile(join(ROOT, '.local', 'lan-access.json'), 'utf8'));
      if (shuttingDown) return;
      if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || config.port === port)
        throw new Error('Port mobile invalide.');
      const endpoints = [
        ...(config.enabled === true ? [{ host: config.host, name: 'LAN', listenPort: config.port }] : []),
        ...(config.tailscale?.enabled === true
          ? [{ host: config.tailscale.host, name: 'Tailscale', listenPort: config.port }]
          : []),
        ...(config.tailscale?.https?.enabled === true
          ? [
              {
                host: '127.0.0.1',
                name: 'PWA HTTPS',
                listenPort: config.tailscale.https.port,
                publicOrigin: config.tailscale.https.origin,
              },
            ]
          : []),
      ];
      for (const { host, name, listenPort, publicOrigin } of endpoints) {
        try {
          if (
            !Number.isInteger(listenPort) ||
            listenPort < 1024 ||
            listenPort > 65535 ||
            listenPort === port ||
            (publicOrigin && listenPort === config.port)
          )
            throw new Error('Port de passerelle invalide.');
          const gateway = createLanGateway({ host, upstreamPort: port, config, publicOrigin });
          remoteServers.push(gateway);
          gateway.on('error', (error) => console.error(`Accès ${name} indisponible : ${error.message}`));
          gateway.listen(listenPort, host, () =>
            console.log(`Accès ${name} — ${publicOrigin || `http://${host}:${listenPort}`}`),
          );
        } catch (error) {
          console.error(`Accès ${name} indisponible : ${error.message}`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(`Accès mobile indisponible : ${error.message}`);
    }
  }
  app.server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Le port ${port} est déjà utilisé. Ouvrez http://127.0.0.1:${port} ou définissez PORT.`
        : error.message,
    );
    process.exitCode = 1;
  });
  app.server.listen(port, '127.0.0.1', () => {
    console.log(`Prime Agent Studio ${VERSION} — http://127.0.0.1:${port}`);
    void startLan();
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      shuttingDown = true;
      for (const gateway of remoteServers) {
        gateway.closeAllConnections();
        gateway.close();
      }
      const timer = setTimeout(() => process.exit(1), 10000);
      timer.unref();
      app.close().then(() => process.exit(0));
    });
}
