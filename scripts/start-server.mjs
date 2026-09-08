import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { stat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  APP_ROOT,
  parsePort,
  pathsFor,
  preparePaths,
  probeHealth,
  acquireLock,
  sleep,
  writeJson,
  recordMessage,
  isDirectInvocation,
  verifyInstallation,
} from './launcher-common.mjs';

async function rotateLog(path) {
  const info = await stat(path).catch(() => null);
  if (info?.size > 2 * 1024 * 1024) {
    await unlink(`${path}.previous`).catch(() => {});
    await rename(path, `${path}.previous`);
  }
}

export async function startServer({
  root = APP_ROOT,
  port = parsePort(),
  timeout = 18000,
  node = process.execPath,
  env = process.env,
} = {}) {
  port = parsePort(port);
  const paths = pathsFor(root, env.PRIME_AGENT_GUI_DATA_DIR);
  verifyInstallation(paths);
  await preparePaths(paths);
  const release = await acquireLock(paths);
  try {
    const initial = await probeHealth(port);
    if (initial.state === 'ready') return { port, reused: true, pid: initial.health.pid };
    if (initial.state === 'occupied')
      throw new Error(`Le port ${port} est utilisé par une autre application. Choisissez un autre PORT.`);

    await rotateLog(paths.serverLog);
    const output = openSync(paths.serverLog, 'a', 0o600);
    const instanceId = randomUUID();
    let child;
    let spawnFailure;
    let exitCode;
    try {
      child = spawn(node, [join(root, 'server.mjs')], {
        cwd: root,
        env: { ...env, PORT: String(port), PRIME_AGENT_GUI_INSTANCE: instanceId },
        windowsHide: true,
        detached: true,
        shell: false,
        stdio: ['ignore', output, output],
      });
      child.on('error', (error) => {
        spawnFailure = error;
      });
      child.on('exit', (code) => {
        exitCode = code ?? -1;
      });
      child.unref();
    } finally {
      closeSync(output);
    }

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (spawnFailure) throw spawnFailure;
      if (exitCode !== undefined)
        throw new Error(
          `Le serveur s'est arrêté au démarrage (code ${exitCode}). Consultez ${paths.serverLog}.`,
        );
      const result = await probeHealth(port, { timeout: 500 });
      if (result.state === 'ready') {
        if (result.health.pid !== child.pid || result.health.instanceId !== instanceId) {
          // A different checkout may have won the port race. Kill only our own child.
          child.kill();
          return { port, reused: true, pid: result.health.pid };
        }
        await writeJson(paths.ownership, {
          pid: child.pid,
          instanceId,
          port,
          startedAt: new Date().toISOString(),
        });
        await recordMessage(paths, `Serveur prêt sur http://127.0.0.1:${port} (PID ${child.pid}).`);
        return { port, reused: false, pid: child.pid };
      }
      await sleep(150);
    }
    child.kill();
    throw new Error(`Le serveur n'a pas répondu dans le délai prévu. Consultez ${paths.serverLog}.`);
  } finally {
    await release();
  }
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const result = await startServer();
    process.stdout.write(`Prime Agent Studio : http://127.0.0.1:${result.port}\n`);
  } catch (error) {
    await recordMessage(pathsFor(), error.stack || String(error)).catch(() => {});
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
