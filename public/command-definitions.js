import { t as tr } from './i18n.js';
// Immediate UI actions are shared with the server. Native capabilities are
// still checked against the installed Prime Agent before submission.
export const STUDIO_COMMANDS = {
  help: [tr('ui.commandes_et_skills'), 'help'],
  skills: [tr('ui.parcourir_les_skills_de_prime_agent'), 'skills'],
  settings: [tr('ui.ouvrir_les_preferences'), 'settings'],
  model: [tr('ui.choisir_un_modele'), 'model', tr('commands.searchHint')],
  effort: [tr('ui.choisir_l_effort_de_raisonnement'), 'effort', tr('commands.levelHint')],
  mcp: [tr('ui.gerer_les_connexions_mcp'), 'mcp'],
  new: [tr('ui.nouvelle_session_dans_ce_projet'), 'new'],
  name: [tr('ui.renommer_cette_session'), 'name', tr('commands.nameHint')],
  session: [tr('ui.afficher_les_informations_de_la_session'), 'session'],
  context: [tr('ui.afficher_le_contexte_de_la_session'), 'session'],
  copy: [tr('ui.copier_la_derniere_reponse_de_l_agent'), 'copy'],
  export: [tr('ui.exporter_la_conversation_depuis_le_studio'), 'export'],
  resume: [tr('ui.rechercher_une_session'), 'resume'],
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
