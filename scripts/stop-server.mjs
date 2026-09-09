import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import {
  APP_ROOT,
  pathsFor,
  preparePaths,
  readJson,
  probeHealth,
  recordMessage,
  acquireLock,
  sleep,
  isDirectInvocation,
} from './launcher-common.mjs';

const execFileAsync = promisify(execFile);

export async function stopServer({ root = APP_ROOT, dataDir, expectedInstanceId, beforeStop } = {}) {
  const paths = pathsFor(root, dataDir);
  await preparePaths(paths);
  const release = await acquireLock(paths);
  try {
    const record = await readJson(paths.ownership);
    if (!record) return { stopped: false, reason: 'not-managed' };
    if (
      !Number.isSafeInteger(record.pid) ||
      record.pid < 1 ||
      !Number.isSafeInteger(record.port) ||
      record.port < 1 ||
      record.port > 65535 ||
      typeof record.instanceId !== 'string' ||
      !record.instanceId
    ) {
      throw new Error('Le fichier de suivi du serveur est invalide. Aucun processus n’a été arrêté.');
    }
    const result = await probeHealth(record.port);
    if (result.state === 'absent') {
      await unlink(paths.ownership).catch(() => {});
      return { stopped: false, reason: 'already-stopped' };
    }
    if (
      result.state !== 'ready' ||
      result.health.pid !== record.pid ||
      result.health.instanceId !== record.instanceId ||
      (expectedInstanceId && record.instanceId !== expectedInstanceId)
    ) {
      throw new Error(
        'Ce serveur ne correspond pas au lancement enregistré. Aucun processus n’a été arrêté.',
      );
    }

    // The desktop updater rechecks activity under the ownership lock immediately
    // before stopping this specific server, including after a confirmation dialog.
    if (beforeStop) await beforeStop(result.health);

    if (process.platform === 'win32') {
      // /T also closes active prime-agent descendants. The verified instance marker
      // prevents stale PID files from targeting an unrelated Node process.
      await execFileAsync('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], {
        windowsHide: true,
        shell: false,
      });
    } else {
      process.kill(record.pid, 'SIGTERM');
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = await probeHealth(record.port, { timeout: 500 });
      if (current.state === 'absent' || current.health?.instanceId !== record.instanceId) {
        await unlink(paths.ownership).catch(() => {});
        await recordMessage(paths, `Serveur arrêté (PID ${record.pid}).`);
        return { stopped: true };
      }
      await sleep(100);
    }
    throw new Error('Le serveur ne confirme pas son arrêt. Consultez le journal du lanceur.');
  } finally {
    await release();
  }
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const result = await stopServer();
    process.stdout.write(
      result.stopped ? 'Prime Agent Studio est arrêté.\n' : 'Aucun serveur géré par ce lanceur à arrêter.\n',
    );
  } catch (error) {
    await recordMessage(pathsFor(), error.stack || String(error)).catch(() => {});
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
