import { t as tr } from './i18n.js';
export const thinkingLabels = {
  get off() {
    return tr('ui.desactivee');
  },
  get minimal() {
    return tr('ui.minimale');
  },
  get low() {
    return tr('ui.faible');
  },
  get medium() {
    return tr('ui.moyenne');
  },
  get high() {
    return tr('ui.elevee');
  },
  get xhigh() {
    return tr('ui.tres_elevee');
  },
  get max() {
    return tr('ui.maximum');
  },
};
export function reasoningMode(preferences = {}) {
  if (['hidden', 'preview', 'expanded'].includes(preferences.reasoningMode)) return preferences.reasoningMode;
  if (typeof preferences.showReasoning === 'boolean')
    return preferences.showReasoning ? 'expanded' : 'hidden';
  return 'preview';
}
export function thinkingLabel(level) {
  return thinkingLabels[level] || tr('ui.non_renseignee');
}
