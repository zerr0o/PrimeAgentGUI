import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, open, unlink, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = new Map();
const PACKAGES = [
  'dill',
  'requests',
  'httpx',
  'pyyaml',
  'tomli',
  'python-dotenv',
  'pandas',
  'numpy',
  'scipy',
  'beautifulsoup4',
  'lxml',
  'pydantic',
  'tyro',
];
const CHECK =
  'import rlm, rlm.repl, dill, requests, httpx, yaml, tomli, dotenv, pandas, numpy, scipy, bs4, lxml, pydantic, tyro; assert rlm.repl.PROTOCOL_VERSION == 3; assert callable(rlm.host_request); assert callable(rlm.run); print("ready")';

function execute(command, args, env, timeout = 300000, signal) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error('Préparation du noyau annulée.'));
      return;
    }
    const child = spawn(command, args, {
      env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      timedOut = false,
      cancelled = false;
    const stop = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32') {
        execFile(
          join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, shell: false, timeout: 10000 },
          () => {
            if (child.exitCode === null && child.signalCode === null) child.kill();
          },
        );
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    };
    const abort = () => {
      cancelled = true;
      stop();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-65536);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-65536);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error(`${command} : ${error.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (cancelled) reject(new Error('Préparation du noyau annulée.'));
      else if (timedOut)
        reject(
          new Error(
            `Le délai de ${Math.round(timeout / 1000)} s est dépassé pour ${command}. Vous pouvez relancer « npm run setup:runtime ».`,
          ),
        );
      else if (code !== 0)
        reject(new Error(`${command} : ${(stderr || `code de sortie ${code}`).trim().slice(-4000)}`));
      else resolvePromise(stdout.trim());
    });
  });
}

async function setupLock(path, signal) {
  const deadline = Date.now() + 330000;
  while (true) {
    if (signal?.aborted) throw new Error('Préparation du noyau annulée.');
    try {
      const file = await open(path, 'wx');
      await file.writeFile(JSON.stringify({ pid: process.pid }));
      return async () => {
        await file.close();
        await unlink(path).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(path, 'utf8'));
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try {
            process.kill(owner.pid, 0);
          } catch (error) {
            if (error.code === 'ESRCH') await unlink(path).catch(() => {});
          }
        }
      } catch {
        // A creator may not have written the PID yet. Only reap an old,
        // incomplete lock; never race a freshly-created lock file.
        const info = await stat(path).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 30000) await unlink(path).catch(() => {});
      }
      if (Date.now() > deadline)
        throw new Error('Une autre préparation du noyau est toujours en cours. Réessayez après sa fin.');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
  }
}

async function fingerprint(source) {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name === '__pycache__') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.py') || entry.name === 'pyproject.toml')
        hash.update(path).update(await readFile(path));
    }
  }
  await walk(source);
  return hash.digest('hex');
}

/** Work around Prime Agent 0.9.1's POSIX-only venv layout, without patching it. */
export async function ensureLocalKernel({
  packageDir,
  env = process.env,
  root = ROOT,
  onProgress = () => {},
  signal,
}) {
  if (signal?.aborted) throw new Error('Préparation du noyau annulée.');
  if (env.PRIME_AGENT_KERNEL_PYTHON) return resolve(env.PRIME_AGENT_KERNEL_PYTHON);
  const venv = join(root, '.local', 'kernel-venv');
  if (jobs.has(venv)) return jobs.get(venv);
  const job = (async () => {
    await mkdir(join(root, '.local'), { recursive: true });
    const release = await setupLock(join(root, '.local', 'kernel-setup.lock'), signal);
    try {
      const source = join(packageDir, 'dist', 'prime-agent-runtime');
      if (!existsSync(join(source, 'pyproject.toml')))
        throw new Error(
          'Le runtime Python fourni avec Prime Agent est introuvable. Réinstallez Prime Agent.',
        );
      const python = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const markerPath = join(root, '.local', 'kernel-ready.json');
      const identity = await fingerprint(source);
      let marker;
      try {
        marker = JSON.parse(await readFile(markerPath, 'utf8'));
      } catch {
        /* Initial setup. */
      }
      if (existsSync(python) && marker?.identity === identity) {
        try {
          await execute(python, ['-c', CHECK], env, 30000, signal);
          return python;
        } catch {
          /* Repair the local environment. */
        }
      }
      const executable = process.platform === 'win32' ? 'uv.exe' : 'uv';
      const candidates = [
        env.PRIME_GUI_UV,
        join(homedir(), '.local', 'bin', executable),
        ...(env.PATH || process.env.PATH || '').split(delimiter).map((path) => join(path, executable)),
      ];
      const uv = candidates.find((path) => path && existsSync(path));
      if (!uv) throw new Error('uv est introuvable. Installez uv, puis relancez « npm run setup:runtime ».');
      onProgress('Préparation du noyau Python local…');
      if (!existsSync(python))
        await execute(uv, ['venv', venv, '--python', '3.11', '--seed'], env, 300000, signal);
      onProgress('Installation du runtime Prime Agent et de ses bibliothèques…');
      await execute(
        uv,
        [
          'pip',
          'install',
          '--python',
          python,
          '--reinstall-package',
          'prime-agent-runtime',
          source,
          ...PACKAGES,
        ],
        env,
        300000,
        signal,
      );
      await execute(python, ['-c', CHECK], env, 30000, signal);
      await writeFile(
        markerPath,
        JSON.stringify({ identity, python, preparedAt: new Date().toISOString() }, null, 2) + '\n',
      );
      onProgress('Le noyau Python est prêt.');
      return python;
    } finally {
      await release();
    }
  })();
  jobs.set(venv, job);
  try {
    return await job;
  } finally {
    jobs.delete(venv);
  }
}
