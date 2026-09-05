import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { agentEnvironment } from './agent.mjs';
import { createMcpConfigStore, mcpRevision } from './mcp-config.mjs';
import { HttpError } from './store.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32')
    execFile(
      join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, shell: false },
      () => {},
    );
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
}
export function createMcpService({
  agentHome,
  environment = process.env,
  store = createMcpConfigStore({ agentHome, env: environment }),
  python = process.env.PRIME_AGENT_KERNEL_PYTHON ||
    join(ROOT, '.local/kernel-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  spawnProcess = spawn,
}) {
  const jobs = new Map(),
    probes = new Set();
  let pendingProbes = 0,
    closed = false;
  function ensureOpen() {
    if (closed) throw new HttpError(503, 'La gestion MCP est en cours de fermeture.');
  }
  function ensureIdle(name) {
    if ([...jobs.values()].some((job) => job.name === name && ['preparing', 'waiting'].includes(job.status)))
      throw new HttpError(409, 'Terminez ou annulez la connexion OAuth de ce serveur avant de le modifier.');
  }
  function snapshot(job) {
    return { id: job.id, name: job.name, status: job.status, url: job.url, error: job.error };
  }
  async function probe(body) {
    ensureOpen();
    if (pendingProbes >= 2) throw new HttpError(429, 'Deux tests MCP sont déjà en cours.');
    pendingProbes++;
    try {
      return await runProbe(body);
    } finally {
      pendingProbes--;
    }
  }
  async function runProbe(body) {
    const selected = await store.get(body.name),
      { config } = selected;
    ensureOpen();
    if (body.revision !== mcpRevision(config))
      throw new HttpError(409, 'Rechargez la liste : ce serveur a changé.');
    if (!existsSync(python))
      throw new HttpError(503, 'Le moteur Python manque. Exécutez npm run setup:runtime sur le PC.');
    if (config.enabled === false) throw new HttpError(400, 'Activez ce serveur avant de le tester.');
    return new Promise((done, reject) => {
      const child = spawnProcess(process.execPath, [join(ROOT, 'scripts/mcp-probe-worker.mjs')], {
        env: agentEnvironment({ agentHome, env: environment }),
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      probes.add(child);
      let output = '',
        settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        probes.delete(child);
        error ? reject(error) : done(value);
      };
      const timer = setTimeout(
        () => {
          stop(child);
          finish(new HttpError(504, 'Le test MCP a dépassé le délai de connexion.'));
        },
        Math.min(config.startupTimeoutMs || 20000, 25000) + 5000,
      );
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.length > 512 * 1024) {
          stop(child);
          finish(new HttpError(502, 'Le catalogue MCP dépasse la taille autorisée.'));
        }
      });
      child.once('error', () => finish(new HttpError(502, 'Impossible de lancer le test MCP.')));
      child.once('close', (code) => {
        try {
          const data = JSON.parse(output.trim());
          if (code !== 0 || data.error || !Array.isArray(data.tools) || !Number.isSafeInteger(data.total))
            throw new Error();
          finish(null, { tools: data.tools, total: data.total, testedAt: new Date().toISOString() });
        } catch {
          finish(
            new HttpError(
              502,
              'Connexion MCP impossible. Vérifiez la commande ou l’URL, les variables et l’authentification.',
            ),
          );
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(
        JSON.stringify({
          agentHome,
          name: body.name,
          revision: body.revision,
          python,
        }),
      );
    });
  }
  async function login(body) {
    ensureOpen();
    ensureIdle(body.name);
    const selected = await store.get(body.name);
    ensureOpen();
    ensureIdle(body.name);
    if (body.revision !== mcpRevision(selected.config))
      throw new HttpError(409, 'Rechargez la liste : ce serveur a changé.');
    if (!selected.config.oauth || selected.config.enabled === false)
      throw new HttpError(400, 'Activez OAuth sur ce serveur avant de vous connecter.');
    if ([...jobs.values()].filter((job) => ['preparing', 'waiting'].includes(job.status)).length >= 2)
      throw new HttpError(429, 'Deux connexions OAuth sont déjà en cours.');
    const child = spawnProcess(process.execPath, [join(ROOT, 'scripts/mcp-oauth-worker.mjs')], {
      env: agentEnvironment({ agentHome, env: environment }),
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const job = { id: randomUUID(), name: body.name, status: 'preparing', child };
    jobs.set(job.id, job);
    const finish = () => {
      clearTimeout(job.timer);
      job.url = undefined;
      setTimeout(() => jobs.delete(job.id), 60000).unref();
    };
    job.timer = setTimeout(() => {
      job.status = 'error';
      job.error = 'Connexion expirée. Relancez-la pour réessayer.';
      stop(child);
      finish();
    }, 180000);
    let pending = '';
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      if (pending.length > 65536) {
        stop(child);
        return;
      }
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (!['preparing', 'waiting'].includes(job.status)) continue;
        try {
          const data = JSON.parse(line);
          if (data.status === 'waiting') {
            const url = new URL(data.url);
            const callback = new URL(url.searchParams.get('redirect_uri'));
            if (
              url.protocol !== 'https:' ||
              url.username ||
              url.password ||
              !url.searchParams.get('state') ||
              callback.protocol !== 'http:' ||
              callback.hostname !== 'localhost' ||
              callback.pathname !== '/callback' ||
              !/^5370[0-9]$/.test(callback.port)
            )
              throw new Error();
            job.url = url.toString();
            job.status = 'waiting';
          } else if (data.status === 'complete') {
            job.status = 'complete';
            finish();
          } else if (data.status === 'error') {
            job.status = 'error';
            job.error = data.error;
            finish();
          }
        } catch {
          job.status = 'error';
          job.error = 'Réponse OAuth invalide.';
          stop(child);
          finish();
        }
      }
    });
    child.on('error', () => {
      job.status = 'error';
      job.error = 'Impossible de démarrer la connexion OAuth.';
      finish();
    });
    child.on('close', () => {
      if (['preparing', 'waiting'].includes(job.status)) {
        job.status = 'error';
        job.error = 'La connexion OAuth a été interrompue.';
        finish();
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ agentHome, name: body.name, revision: body.revision }) + '\n');
    return snapshot(job);
  }
  function jobFor(id) {
    const job = jobs.get(id);
    if (!job) throw new HttpError(404, 'Connexion OAuth introuvable ou expirée.');
    return job;
  }
  function complete(body) {
    const job = jobFor(body.id);
    if (job.status !== 'waiting') throw new HttpError(409, 'Cette connexion n’attend pas de réponse.');
    let returned, auth;
    try {
      returned = new URL(body.url);
      auth = new URL(job.url);
    } catch {
      throw new HttpError(400, 'Collez l’adresse complète obtenue après autorisation.');
    }
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    if (
      returned.origin !== callback.origin ||
      returned.pathname !== callback.pathname ||
      !returned.searchParams.get('code') ||
      !auth.searchParams.get('state') ||
      returned.searchParams.get('state') !== auth.searchParams.get('state')
    )
      throw new HttpError(400, 'Cette adresse de retour ne correspond pas à la connexion en cours.');
    job.child.stdin.write(JSON.stringify({ type: 'complete', url: returned.toString() }) + '\n');
    return snapshot(job);
  }
  function cancel(id) {
    const job = jobFor(id);
    if (['preparing', 'waiting'].includes(job.status)) {
      job.status = 'cancelled';
      clearTimeout(job.timer);
      stop(job.child);
      job.url = undefined;
      setTimeout(() => jobs.delete(id), 60000).unref();
    }
    return snapshot(job);
  }
  return {
    list: store.list,
    probe,
    login,
    complete,
    cancel,
    job: (id) => snapshot(jobFor(id)),
    upsert: (body) => {
      ensureIdle(body.name);
      return store.upsert(body);
    },
    remove: (body) => {
      ensureIdle(body.name);
      return store.remove(body);
    },
    toggle: (body) => {
      ensureIdle(body.name);
      return store.toggle(body);
    },
    disconnect: (body) => {
      ensureIdle(body.name);
      return store.disconnect(body);
    },
    close() {
      closed = true;
      for (const child of probes) stop(child);
      for (const job of jobs.values()) {
        clearTimeout(job.timer);
        stop(job.child);
      }
    },
  };
}
