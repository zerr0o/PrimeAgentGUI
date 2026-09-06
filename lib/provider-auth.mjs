import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverCli } from './agent.mjs';
import { HttpError } from './store.mjs';

const clean = (value, limit = 160) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit) : '';
export const credentialRevision = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
export function providerId(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  )
    throw new HttpError(400, 'Fournisseur invalide.');
  return value;
}
const guidance = {
  'prime-inference':
    'La variable PRIME_API_KEY et la configuration Prime CLI sont prioritaires sur la clé enregistrée ici. Elles restent gérées séparément.',
  'amazon-bedrock':
    'Utilisez un profil AWS ou les variables AWS du PC. Ces réglages restent gérés par votre environnement.',
  'google-vertex':
    'Configurez les identifiants Google Cloud, le projet et la région dans l’environnement du PC.',
  'azure-openai-responses':
    'La clé peut être enregistrée ici. L’adresse Azure et les déploiements se règlent dans l’environnement du PC.',
  'cloudflare-ai-gateway':
    'La clé peut être enregistrée ici. Le compte et la passerelle Cloudflare se règlent dans l’environnement du PC.',
  'cloudflare-workers-ai':
    'La clé peut être enregistrée ici. Le compte Cloudflare se règle dans l’environnement du PC.',
};
export async function createProviderAuth({ agentHome, native } = {}) {
  for (const name of ['auth.json', 'models.json']) {
    const info = await lstat(join(agentHome, name)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (info && (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024))
      throw new HttpError(409, 'Le fichier de configuration doit être un fichier local de taille normale.');
  }
  if (!native) {
    const cli = discoverCli();
    if (!cli?.packageDir) throw new HttpError(503, 'Installez Prime Agent pour gérer les fournisseurs.');
    const importNative = (path) => import(pathToFileURL(join(cli.packageDir, path)).href);
    const [auth, models] = await Promise.all([
      importNative('dist/core/auth-storage.js'),
      importNative('dist/core/model-registry.js'),
    ]);
    native = { ...auth, ...models };
  }
  const backend = new native.FileAuthStorageBackend(join(agentHome, 'auth.json'));
  backend.withLock((current) => {
    const content = JSON.parse(current || '{}');
    if (!content || Array.isArray(content) || typeof content !== 'object')
      throw new HttpError(
        409,
        'Le fichier auth.json est invalide. Les connexions existantes ont été conservées.',
      );
    return { result: undefined };
  });
  const auth = native.AuthStorage.fromStorage(backend);
  if (auth.drainErrors().length)
    throw new HttpError(
      409,
      'Impossible de lire les connexions existantes. Corrigez auth.json avant de continuer.',
    );
  const registry = native.ModelRegistry.create(auth, join(agentHome, 'models.json'));
  const oauth = new Map(
    auth
      .getOAuthProviders()
      .filter((p) => !p.id.startsWith('mcp:'))
      .map((p) => [p.id, p]),
  );
  const counts = new Map();
  for (const model of registry.getAll()) counts.set(model.provider, (counts.get(model.provider) || 0) + 1);
  const ids = new Set([
    ...counts.keys(),
    ...oauth.keys(),
    ...auth.list().filter((id) => !id.startsWith('mcp:') && id !== 'serper' && id !== 'prime-agent-traces'),
  ]);
  function item(id) {
    providerId(id);
    if (!ids.has(id))
      throw new HttpError(404, 'Fournisseur inconnu. Ajoutez d’abord ses modèles dans le configurateur.');
    const status = registry.getProviderAuthStatus(id),
      stored = auth.get(id);
    const methods = [];
    if (oauth.has(id)) methods.push('oauth');
    if (!['amazon-bedrock', 'google-vertex', 'openai-codex', 'github-copilot'].includes(id))
      methods.push('api_key');
    return {
      id,
      name: clean(oauth.get(id)?.name || registry.getProviderDisplayName(id) || id),
      methods,
      configured: !!status.source && status.source !== 'stale',
      source: [
        'stored',
        'environment',
        'prime_cli',
        'models_json_key',
        'models_json_command',
        'stale',
        'fallback',
        'runtime',
      ].includes(status.source)
        ? status.source
        : null,
      stored: !!stored,
      credentialType: stored?.type === 'oauth' ? 'oauth' : stored ? 'api_key' : null,
      revision: credentialRevision(stored),
      models: counts.get(id) || 0,
      guidance: guidance[id] || '',
    };
  }
  function selected(body) {
    const entry = item(body.provider);
    if (body.revision !== entry.revision)
      throw new HttpError(409, 'Cette connexion a changé. Actualisez la liste avant de réessayer.');
    return entry;
  }
  function persist(body, credential) {
    selected(body);
    // Apply the revision check inside Prime Agent's own file lock. Another
    // provider or MCP may change concurrently; its credentials are preserved.
    const guarded = {
      withLock: (fn) =>
        backend.withLock((current) => {
          const result = fn(current);
          if (
            result.next !== undefined &&
            credentialRevision(JSON.parse(current || '{}')[body.provider]) !== body.revision
          )
            throw new HttpError(409, 'Cette connexion a changé. Actualisez la liste avant de réessayer.');
          return result;
        }),
      withLockAsync: (fn) => backend.withLockAsync(fn),
    };
    const writer = native.AuthStorage.fromStorage(guarded, { usePrimeCliConfig: false });
    if (writer.drainErrors().length)
      throw new HttpError(409, 'Impossible de lire les connexions existantes.');
    if (credential) writer.set(body.provider, credential);
    else writer.removeVerified(body.provider);
    const errors = writer.drainErrors();
    if (errors.length)
      throw (
        errors.find((error) => error.status) ||
        new HttpError(500, 'La connexion n’a pas pu être enregistrée.')
      );
    auth.reload();
    return { provider: body.provider, saved: true };
  }
  return {
    entry: selected,
    list: () => ({
      providers: [...ids]
        .filter(
          (id) =>
            /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id) &&
            !['constructor', 'prototype', '__proto__'].includes(id),
        )
        .map(item)
        .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name)),
      warning: registry.getError()
        ? 'Certaines définitions de modèles ne peuvent pas être chargées. Vérifiez le configurateur de modèles.'
        : null,
    }),
    async save(body) {
      const entry = selected(body);
      if (!entry.methods.includes('api_key'))
        throw new HttpError(400, 'Ce fournisseur utilise un autre mode de connexion.');
      const value = typeof body.value === 'string' ? body.value.trim() : '';
      if (!value || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value) || value.startsWith('!'))
        throw new HttpError(400, 'Saisissez une clé valide, sans espaces ni commande.');
      if (!['key', 'environment'].includes(body.kind)) throw new HttpError(400, 'Mode de clé invalide.');
      if (body.kind === 'environment' && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(value))
        throw new HttpError(400, 'Nom de variable invalide.');
      if (body.kind === 'environment' && !process.env[value])
        throw new HttpError(
          400,
          'Cette variable est absente ou vide dans l’environnement du Studio. Configurez-la sur le PC avant de continuer.',
        );
      if (body.kind === 'key' && process.env[value] !== undefined)
        throw new HttpError(
          400,
          'Cette valeur correspond à une variable du PC. Choisissez le mode Variable d’environnement.',
        );
      return persist(body, { type: 'api_key', key: value });
    },
    remove(body) {
      if (!selected(body).stored) throw new HttpError(400, 'Cette connexion est gérée en dehors du Studio.');
      return persist(body, null);
    },
    async login(body, callbacks, beforeSave = async () => {}) {
      const entry = selected(body),
        provider = oauth.get(entry.id);
      if (!provider)
        throw new HttpError(400, 'La connexion par compte n’est pas disponible pour ce fournisseur.');
      const credentials = await provider.login(callbacks);
      await beforeSave(entry);
      return persist(body, { ...credentials, type: 'oauth' });
    },
  };
}
