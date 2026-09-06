import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
let packageRoot;
export function initialize(data) {
  packageRoot = resolve(data.packageRoot);
}
export function transformKernelBootstrap(source, { required = false } = {}) {
  const target = 'function ensureKernelPython(options = {}) {';
  if (!source.includes(target) && !required) return { source, changed: false };
  if (source.split(target).length !== 2)
    throw new Error(
      'Cette version de Prime Agent nécessite une mise à jour de la préparation des kernels du Studio.',
    );
  const helper = new URL('./kernel-bootstrap.mjs', import.meta.url).href;
  return {
    changed: true,
    source:
      `import { prepareKernel as studioPrepareKernel } from ${JSON.stringify(helper)};\n` +
      source.replace(target, `${target}\nreturn studioPrepareKernel(options);`),
  };
}
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!packageRoot || !url.startsWith('file:') || result.format !== 'module') return result;
  const path = relative(packageRoot, fileURLToPath(url)).replaceAll('\\', '/');
  const unbundled = path === 'dist/core/kernel/bootstrap.js';
  if (!unbundled && !/^dist\/bundle\/[^/]+\.m?js$/.test(path)) return result;
  const source =
    typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  const transformed = transformKernelBootstrap(source, { required: unbundled });
  return transformed.changed ? { ...result, source: transformed.source } : result;
}
