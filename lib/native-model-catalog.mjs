import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerPath = fileURLToPath(new URL('../scripts/model-catalog-worker.mjs', import.meta.url));

function unavailable(code = 'NATIVE_MODEL_CATALOG_UNAVAILABLE') {
  const error = new Error('Le catalogue natif des modèles est indisponible.');
  error.code = code;
  return error;
}

/** Keep native auth, provider registries and their background requests outside the Studio server. */
export function createNativeModelCatalog({ cli, agentHome, env = process.env } = {}) {
  let worker;
  let closed = false;
  let sequence = 0;
  let closePromise;
  const pending = new Map();

  function rejectPending(current) {
    for (const [id, request] of pending) {
      if (request.worker !== current) continue;
      clearTimeout(request.timer);
      pending.delete(id);
      request.reject(unavailable(closed ? 'NATIVE_MODEL_CATALOG_CLOSED' : undefined));
    }
  }

  function start() {
    if (closed) throw unavailable('NATIVE_MODEL_CATALOG_CLOSED');
    if (worker?.connected) return worker;
    if (!cli?.packageDir || !agentHome || !existsSync(join(cli.packageDir, 'dist', 'index.js')))
      throw unavailable();
    const launchEnv = { ...env, PRIME_AGENT_CODING_AGENT_DIR: agentHome };
    for (const name of Object.keys(launchEnv))
      if (name.startsWith('PRIME_AGENT_INTERNAL_') || name === 'PRIME_GUI_CONTROL') delete launchEnv[name];
    const current = fork(workerPath, [], {
      env: launchEnv,
      execArgv: [],
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    worker = current;
    // Idle catalogues must neither retain the server nor survive its IPC disconnect.
    current.unref();
    current.channel?.unref();
    current.on('message', (message) => {
      const request = pending.get(message?.id);
      if (!request || request.worker !== current) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.ok && Array.isArray(message.catalog?.models)) request.resolve(message.catalog);
      else request.reject(unavailable());
    });
    const failed = () => {
      if (worker === current) worker = undefined;
      rejectPending(current);
    };
    current.on('error', failed);
    current.on('exit', failed);
    current.on('disconnect', failed);
    return current;
  }

  async function read({ refresh = false } = {}) {
    const current = start();
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (worker === current) worker = undefined;
        rejectPending(current);
        current.kill();
      }, 30_000);
      pending.set(id, { worker: current, resolve, reject, timer });
      current.send(
        { id, type: 'read', packageDir: cli.packageDir, agentHome, refresh: refresh === true },
        (error) => {
          if (!error) return;
          if (worker === current) worker = undefined;
          rejectPending(current);
          current.kill();
        },
      );
    });
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    const current = worker;
    worker = undefined;
    if (!current) return (closePromise = Promise.resolve());
    rejectPending(current);
    closePromise = new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      current.once('exit', finish);
      timer = setTimeout(() => {
        current.kill('SIGKILL');
        finish();
      }, 1000);
      if (current.connected) current.send({ type: 'close' }, () => {});
      else current.kill();
      if (current.exitCode !== null || current.signalCode !== null) finish();
    });
    return closePromise;
  }

  return { read, close };
}
