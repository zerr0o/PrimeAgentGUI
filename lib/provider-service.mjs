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
    if (closed) throw new HttpError(503, 'La gestion des fournisseurs est en cours de fermeture.');
  }
  function validate(body) {
    providerId(body.provider);
    if (typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision))
      throw new HttpError(400, 'Actualisez la liste des fournisseurs.');
  }
  function checkBusy(body, operation, replacing = false) {
    if ((replacing || operation === 'remove' || body.revision !== credentialRevision(null)) && isBusy())
      throw new HttpError(
        409,
        'Attendez la fin des exécutions du Studio pour remplacer ou retirer une connexion. Vous pouvez ajouter un autre fournisseur.',
      );
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
      if (total > 1024 * 1024) return fail(new HttpError(502, 'Réponse du fournisseur trop volumineuse.'));
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          receive(JSON.parse(line));
        } catch (error) {
          fail(error.status ? error : new HttpError(502, 'Réponse du fournisseur invalide.'));
        }
      }
    });
    child.once('error', () => fail(new HttpError(502, 'Impossible de démarrer la connexion.')));
    child.once('close', () => fail(new HttpError(502, 'La connexion a été interrompue.')));
  }
  function errorFrom(data) {
    return new HttpError(
      [400, 404, 409, 429, 500, 502, 503].includes(data.status) ? data.status : 502,
      text(data.error) || 'Connexion impossible.',
    );
  }
  async function request(operation, body = {}) {
    open();
    if (operation !== 'list') {
      validate(body);
      checkBusy(body, operation);
      if (locks.has(body.provider))
        throw new HttpError(409, 'Une modification de ce fournisseur est déjà en cours.');
      locks.add(body.provider);
    }
    try {
      if (operations.size >= 4) throw new HttpError(429, 'Patientez pendant le chargement des fournisseurs.');
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
          () => finish(new HttpError(504, 'Le chargement a expiré. Réessayez.')),
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
      throw new HttpError(409, 'Une connexion à ce fournisseur est déjà en cours.');
    if ([...jobs.values()].some((job) => !terminal(job)))
      throw new HttpError(409, 'Terminez ou annulez la connexion en cours avant d’en ouvrir une autre.');
    const child = launch();
    const job = { id: randomUUID(), provider: body.provider, status: 'preparing', child, prompts: new Map() };
    jobs.set(job.id, job);
    locks.add(body.provider);
    job.timer = setTimeout(
      () => finish(job, 'error', 'Connexion expirée. Relancez-la pour réessayer.'),
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
    if (!job) throw new HttpError(404, 'Connexion introuvable ou expirée.');
    return job;
  }
  return {
    list: async () => ({
      ...(await request('list')),
      busy: isBusy(),
      activeLogin: [...jobs.values()].find((job) => !terminal(job))?.id || null,
    }),
    save: (body) => request('save', body),
    remove: (body) => request('remove', body),
    login,
    job: (id) => snapshot(find(id)),
    answer(id, body) {
      const job = find(id),
        prompt = job.prompts.get(body.promptId);
      if (terminal(job) || !prompt)
        throw new HttpError(409, 'Cette étape de connexion n’attend plus de réponse.');
      if (
        typeof body.value !== 'string' ||
        body.value.length > 16000 ||
        (!body.value.trim() && !prompt.allowEmpty) ||
        /[\u0000-\u001f\u007f]/.test(body.value)
      )
        throw new HttpError(400, 'Saisissez une réponse valide.');
      if (prompt.kind === 'select' && !prompt.options.some((option) => option.id === body.value))
        throw new HttpError(400, 'Choix invalide.');
      job.child.stdin.write(
        JSON.stringify({ type: 'answer', id: prompt.id, value: body.value.trim() }) + '\n',
      );
      job.prompts.delete(body.promptId);
      return snapshot(job);
    },
    cancel(id) {
      const job = find(id);
      if (job.status === 'saving') throw new HttpError(409, 'Enregistrement en cours, patientez un instant.');
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
