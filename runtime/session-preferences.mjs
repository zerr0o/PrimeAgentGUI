// Studio conversations retain native model/thinking entries without changing
// Prime Agent's defaults. Explicit defaults are managed by the Settings API.
export function transformSessionPreferences(source, { required = false } = {}) {
  if (!source.includes('setThinkingLevel(level) {') && !required) return { source, changed: false };
  const thinking = 'this.settingsManager.setDefaultThinkingLevel(effectiveLevel);';
  const models =
    /this\.settingsManager\.setDefaultModelAndProvider\((?:model\.provider, model\.id|next\.model\.provider, next\.model\.id|nextModel\.provider, nextModel\.id)\);/g;
  if (source.split(thinking).length !== 2 || [...source.matchAll(models)].length !== 3)
    throw new Error(
      'La portée des réglages de conversation nécessite une mise à jour de l’adaptateur du Studio.',
    );
  return {
    changed: true,
    source: source
      .replace(thinking, '/* Studio: session preference only. */')
      .replace(models, '/* Studio: session preference only. */'),
  };
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!packageRoot || !url.startsWith('file:') || result.format !== 'module') return result;
  const path = relative(packageRoot, fileURLToPath(url)).replaceAll('\\', '/');
  const unbundled = path === 'dist/core/agent-session.js';
  if (!unbundled && !/^dist\/bundle\/[^/]+\.m?js$/.test(path)) return result;
  const source =
    typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  // Other bundles contain unrelated setters; only the native AgentSession owns this method.
  if (!unbundled && !source.includes('async _startRlmChildRun(')) return result;
  const changed = transformSessionPreferences(source, { required: true });
  return { ...result, source: changed.source };
}
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
let packageRoot;
export function initialize(data) {
  packageRoot = resolve(data.packageRoot);
}
