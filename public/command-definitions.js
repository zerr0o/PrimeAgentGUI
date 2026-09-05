// Immediate UI actions are shared with the server. Native capabilities are
// still checked against the installed Prime Agent before submission.
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
export const immediateCommands = Object.entries(STUDIO_COMMANDS).map(
  ([name, [description, action, argumentHint]]) => ({
    name,
    description,
    action,
    argumentHint,
    source: 'studio',
    supported: true,
  }),
);
