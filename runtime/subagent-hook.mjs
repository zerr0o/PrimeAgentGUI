import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
let packageRoot;
export function initialize(data) {
  packageRoot = resolve(data.packageRoot);
}
export function transformSubagentSession(source, { required = false } = {}) {
  if (!source.includes('async _startRlmChildRun(') && !required) return { source, changed: false };
  const replaceOnce = (before, after) => {
    if (source.split(before).length !== 2)
      throw new Error(
        'Cette version de Prime Agent nécessite une mise à jour de l’adaptateur de sous-agents du Studio.',
      );
    source = source.replace(before, after);
  };
  replaceOnce(
    'async _startRlmChildRun(prompt, kwargs = {}, spawnCode) {',
    'async _startRlmChildRun(prompt, kwargs = {}, spawnCode) {\nkwargs = studioApplySubagentDefaults(this._cwd, kwargs);',
  );
  replaceOnce(
    'const loaderAppendSystemPrompt = this._resourceLoader.getAppendSystemPrompt();',
    'const loaderAppendSystemPrompt = [...this._resourceLoader.getAppendSystemPrompt(), studioSubagentInstruction(this._cwd)].filter(Boolean);',
  );
  replaceOnce(
    'const executionPolicy = firstTurn.payload.executionPolicy;',
    'const executionPolicy = firstTurn.payload.executionPolicy;\nthis._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());',
  );
  const runNames = [...source.matchAll(/sessionName: child\?\.sessionName \?\? run\d*\.sessionName,/g)];
  const childModels = [
    ...source.matchAll(
      /model: child\.model \? `\$\{child\.model\.provider\}\/\$\{child\.model\.id\}` : (?:undefined|void 0),/g,
    ),
  ];
  if (runNames.length !== 1 || childModels.length !== 1)
    throw new Error('La télémétrie des sous-agents nécessite une mise à jour de l’adaptateur du Studio.');
  replaceOnce(runNames[0][0], `${runNames[0][0]}\nthinkingLevel: child?.thinkingLevel,`);
  replaceOnce(childModels[0][0], `${childModels[0][0]}\nthinkingLevel: child.thinkingLevel,`);
  const helper = new URL('./subagent-policy.mjs', import.meta.url).href;
  return {
    changed: true,
    source: `import { applySubagentDefaults as studioApplySubagentDefaults, subagentInstruction as studioSubagentInstruction } from ${JSON.stringify(helper)};\n${source}`,
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
  const transformed = transformSubagentSession(source, { required: unbundled });
  return transformed.changed ? { ...result, source: transformed.source } : result;
}
