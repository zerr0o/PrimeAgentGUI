import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGINAL_CALL = 'await connection.waitForHeadlessCompletion()';
const WAIT_FOR_CHILDREN = 'await connection.waitForHeadlessCompletion({ waitForRlmQuiescence: true })';
const PRINT_MARKER = /^\/\/ (?:dist|src)\/modes\/print-mode\.(?:js|ts)\s*$/m;
let packageRoot;

export function initialize(data) {
  packageRoot = resolve(data.packageRoot);
}

function unsupported(url) {
  return new Error(
    `La version de Prime Agent a changé : le studio ne peut pas activer l’attente des agents délégués dans ${url || 'print-mode'}. Mettez à jour l’adaptateur du studio.`,
  );
}

/** Enable the native completion barrier only in the print-mode teardown path. */
export function transformPrintMode(source, { required = false, url } = {}) {
  const hasPrintFunction = /\bfunction\s+runPrintModeWithConnectionInternal\s*\(/.test(source);
  if (!required && !hasPrintFunction && !PRINT_MARKER.test(source)) return { source, changed: false };
  // The distributed ESM and esbuild bundle both retain this top-level function.
  // Requiring its exact boundary avoids changing RPC/ACP or another wait call.
  const functions = [
    ...source.matchAll(
      /^(?:export )?async function runPrintModeWithConnectionInternal\([^\n]*\) \{[\s\S]*?^\}/gm,
    ),
  ];
  if (functions.length !== 1) throw unsupported(url);
  const match = functions[0];
  const body = match[0];
  if (body.split(ORIGINAL_CALL).length !== 2) throw unsupported(url);
  const patched = body.replace(ORIGINAL_CALL, WAIT_FOR_CHILDREN);
  return {
    source: source.slice(0, match.index) + patched + source.slice(match.index + body.length),
    changed: true,
  };
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!packageRoot || !url.startsWith('file:') || result.format !== 'module') return result;
  const path = relative(packageRoot, fileURLToPath(url)).replaceAll('\\', '/');
  const unbundledPrint = path === 'dist/modes/print-mode.js';
  if (!unbundledPrint && !/^dist\/bundle\/[^/]+\.m?js$/.test(path)) return result;
  const source =
    typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  const transformed = transformPrintMode(source, { required: unbundledPrint, url });
  return transformed.changed ? { ...result, source: transformed.source } : result;
}
