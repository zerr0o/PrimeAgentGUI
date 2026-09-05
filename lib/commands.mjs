import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentEnvironment, discoverCli } from './agent.mjs';
import { HttpError, validateDirectory } from './store.mjs';

export const SESSION_COMMANDS = new Set(['compact', 'refine', 'goal', 'autonomous']);
export const STUDIO_COMMANDS = {
  help: ['Commandes et skills', 'help'],
  skills: ['Parcourir les skills de Prime Agent', 'skills'],
  settings: ['Ouvrir les préférences', 'settings'],
  model: ['Choisir un modèle', 'model', '[recherche]'],
  effort: ['Choisir l’effort de raisonnement', 'effort', '[niveau]'],
  mcp: ['Gérer les connexions MCP', 'mcp'],
  new: ['Nouvelle session dans ce projet', 'new'],
  name: ['Renommer cette session', 'name', '[nom]'],
  session: ['Afficher les informations de la session', 'session'],
  context: ['Afficher le contexte de la session', 'session'],
  copy: ['Copier la dernière réponse de l’agent', 'copy'],
  export: ['Exporter la conversation depuis le Studio', 'export'],
  resume: ['Rechercher une session', 'resume'],
};
export const COMMAND_ALIASES = { clear: 'new', usage: 'context', thinking: 'effort', rename: 'name' };
const descriptions = {
  compact: 'Résumer le contexte de la session',
  refine: 'Améliorer les instructions et ressources réutilisables',
  goal: 'Définir ou gérer un objectif persistant',
  autonomous: 'Afficher, activer ou désactiver le mode autonome',
};
export function parseCommand(text) {
  const match = typeof text === 'string' && text.trim().match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
  return match
    ? {
        name: Object.hasOwn(COMMAND_ALIASES, match[1]) ? COMMAND_ALIASES[match[1]] : match[1],
        args: (match[2] || '').trim(),
      }
    : null;
}
export function commandCatalog(native) {
  const builtin = native.builtins || [];
  const commands = Object.entries(STUDIO_COMMANDS).map(([name, [description, action, argumentHint]]) => ({
    name,
    description,
    action,
    argumentHint,
    source: 'studio',
    supported: true,
  }));
  for (const command of builtin) {
    if (Object.hasOwn(STUDIO_COMMANDS, command.name)) continue;
    commands.push({
      ...command,
      description: descriptions[command.name] || command.description,
      source: 'native',
      supported: SESSION_COMMANDS.has(command.name),
      ...(SESSION_COMMANDS.has(command.name)
        ? {}
        : { reason: 'Cette commande nécessite l’interface terminal de Prime Agent.' }),
    });
  }
  for (const command of native.commands || []) {
    if (commands.some((item) => item.name === command.name)) continue;
    commands.push({
      ...command,
      supported: command.source !== 'extension',
      ...(command.source === 'extension'
        ? { reason: 'Les extensions interactives nécessitent le terminal Prime Agent.' }
        : {}),
    });
  }
  return { commands, diagnostics: native.diagnostics || [], live: native.live === true };
}

/** Reject terminal-only/unknown commands before they can become an ordinary model prompt. */
export function validateCommand(text, catalog, { attachments = false } = {}) {
  const parsed = parseCommand(text);
  if (!parsed) return;
  const command = catalog.commands.find((item) => item.name === parsed.name);
  if (!command)
    throw new HttpError(
      400,
      `Commande /${parsed.name} inconnue dans ce projet. Ouvrez le menu / pour choisir une commande.`,
    );
  if (!command.supported) throw new HttpError(400, command.reason);
  if (command.source === 'studio')
    throw new HttpError(400, 'Cette commande s’utilise depuis le menu du Studio.');
  if (SESSION_COMMANDS.has(command.name)) {
    if (/[\r\n\u2028\u2029]/.test(text.trim()) || attachments)
      throw new HttpError(400, 'Une commande de session s’écrit sur une seule ligne, sans pièce jointe.');
  }
}

export function createCommandService({ agentHome, getLiveClient } = {}) {
  const workers = new Set();
  const cache = new Map();
  let closed = false;
  function read(cwd) {
    const hit = cache.get(cwd);
    if (hit && hit.expires > Date.now()) return hit.promise;
    if (workers.size >= 3) throw new HttpError(429, 'Le catalogue se charge. Réessayez dans un instant.');
    const cli = discoverCli();
    if (!cli?.packageDir)
      throw new HttpError(503, 'Installez Prime Agent pour utiliser ses commandes et skills.');
    const promise = new Promise((resolve, reject) => {
      const child = fork(
        fileURLToPath(new URL('../scripts/command-catalog-worker.mjs', import.meta.url)),
        [],
        {
          cwd,
          env: agentEnvironment({ agentHome }),
          execArgv: [],
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      workers.add(child);
      const timer = setTimeout(
        () => finish(new HttpError(504, 'Le catalogue Prime Agent met trop de temps à répondre.')),
        15000,
      );
      let finished = false;
      function finish(error, result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        workers.delete(child);
        child.kill();
        if (error) {
          cache.delete(cwd);
          reject(error);
        } else resolve(result);
      }
      child.on('error', () => finish(new HttpError(503, 'Impossible de lire le catalogue Prime Agent.')));
      child.on('exit', () => finish(new HttpError(503, 'Le lecteur du catalogue Prime Agent s’est arrêté.')));
      child.on('message', (data) =>
        data?.ok
          ? finish(null, data.catalog)
          : finish(new HttpError(503, 'Le catalogue nécessite une version compatible de Prime Agent.')),
      );
      child.send({ cwd, agentHome, packageDir: cli.packageDir });
    });
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    cache.set(cwd, { promise, expires: Date.now() + 5000 });
    return promise;
  }
  return {
    async list({ cwd, sessionId } = {}) {
      if (closed) throw new HttpError(503, 'Le Studio s’arrête.');
      cwd = await validateDirectory(cwd);
      const native = await read(cwd);
      const client = sessionId && (await getLiveClient?.(sessionId, cwd));
      if (client) {
        try {
          const commands = await client.getCommands(sessionId, cwd);
          return commandCatalog({
            ...native,
            commands: commands.map((c) => ({
              ...native.commands.find(
                (item) => item.name === c.name && item.sourceInfo?.path === c.sourceInfo?.path,
              ),
              ...c,
            })),
            live: true,
          });
        } finally {
          client.close?.();
        }
      }
      return commandCatalog(native);
    },
    close() {
      closed = true;
      for (const child of workers) child.kill();
      cache.clear();
    },
  };
}
