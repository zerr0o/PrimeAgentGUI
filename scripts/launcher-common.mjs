import { request } from 'node:http';
import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SERVICE = 'prime-agent-gui';
export const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

export function parsePort(value = process.env.PORT || '3088') {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('PORT doit être un nombre entier entre 1 et 65535.');
  }
  return Number(value);
}

export function pathsFor(root = APP_ROOT) {
  const local = join(root, '.local');
  return {
    root,
    local,
    logs: join(local, 'logs'),
    ownership: join(local, 'server.json'),
    lock: join(local, 'launcher.lock'),
    serverLog: join(local, 'logs', 'server.log'),
    launcherLog: join(local, 'logs', 'launcher.log'),
  };
}

export async function preparePaths(paths) {
  await mkdir(paths.logs, { recursive: true });
}

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function recordMessage(paths, message) {
  await preparePaths(paths);
  await writeFile(paths.launcherLog, `${new Date().toISOString()} ${message}\n`, { flag: 'a' });
}

/** Distinguish a missing server from an occupied port; never reuse a foreign service. */
export function probeHealth(port, { timeout = 1000 } = {}) {
  return new Promise((done) => {
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(result);
    };
    const req = request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 16 * 1024) {
          finish({ state: 'occupied' });
          req.destroy();
        }
      });
      response.on('end', () => {
        let health;
        try {
          health = JSON.parse(body);
        } catch {
          /* Not our service. */
        }
        const ours = response.statusCode === 200 && health?.service === SERVICE && health?.status === 'ok';
        finish(ours ? { state: 'ready', health } : { state: 'occupied' });
      });
      response.on('error', () => finish({ state: 'occupied' }));
    });
    req.on('error', (error) => finish({ state: error.code === 'ECONNREFUSED' ? 'absent' : 'occupied' }));
    timer = setTimeout(() => {
      finish({ state: 'occupied' });
      req.destroy();
    }, timeout);
    req.end();
  });
}

/** A bounded lock prevents rapid double-clicks from starting multiple copies. */
export async function acquireLock(paths, { timeout = 22000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const handle = await open(paths.lock, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      await handle.close();
      return async () => {
        const owner = await readJson(paths.lock);
        if (owner?.pid === process.pid) await unlink(paths.lock).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readJson(paths.lock);
      let alive = false;
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
          alive = true;
        } catch (error) {
          alive = error.code === 'EPERM';
        }
      }
      // An incomplete lock may still be being written. Allow a short grace period.
      if ((!alive && owner) || (owner?.createdAt && Date.now() - owner.createdAt > 60000)) {
        await unlink(paths.lock).catch(() => {});
      } else if (!owner) {
        const { stat } = await import('node:fs/promises');
        const info = await stat(paths.lock).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 5000) await unlink(paths.lock).catch(() => {});
      }
      await sleep(125);
    }
  }
  throw new Error('Un lancement est déjà en cours. Réessayez dans quelques secondes.');
}

export function isDirectInvocation(metaUrl) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

export function verifyInstallation(paths) {
  if (!existsSync(join(paths.root, 'server.mjs'))) {
    throw new Error('server.mjs est introuvable. Conservez le lanceur dans le dossier Prime Agent Studio.');
  }
}
