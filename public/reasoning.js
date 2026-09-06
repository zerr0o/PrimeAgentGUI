export const thinkingLabels = {
  off: 'Désactivée',
  minimal: 'Minimale',
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Élevée',
  xhigh: 'Très élevée',
  max: 'Maximum',
};
export function reasoningMode(preferences = {}) {
  if (['hidden', 'preview', 'expanded'].includes(preferences.reasoningMode)) return preferences.reasoningMode;
  if (typeof preferences.showReasoning === 'boolean')
    return preferences.showReasoning ? 'expanded' : 'hidden';
  return 'preview';
}
export function thinkingLabel(level) {
  return thinkingLabels[level] || 'Non renseignée';
}
