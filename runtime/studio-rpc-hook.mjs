import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let packageRoot;
export function initialize(data) {
  packageRoot = data.packageRoot;
}

// Keep Prime Agent's RPC loop, native UI replies and completion barrier. Only
// expose the existing barrier and acknowledge UI replies to the owning Studio.
export function transformStudioRpc(source, { required = false } = {}) {
  if (!source.includes('function runRpcModeWithConnectionInternal(') && !required)
    return { source, changed: false };
  const functions = [
    ...source.matchAll(
      /^(?:export )?async function runRpcModeWithConnectionInternal\([^\n]*\) \{[\s\S]*?^\}/gm,
    ),
  ];
  if (functions.length !== 1)
    throw new Error('Le protocole interactif de Prime Agent a changé. Mettez à jour le Studio.');
  const match = functions[0],
    body = match[0];
  const command = 'case "get_state": {';
  const replies = [
    ...body.matchAll(
      /await connection\.respondToExtensionUiRequest\(response\.id, daemonResponse\)\.catch\(\(\) => (?:undefined|void 0)\);/g,
    ),
  ];
  const reply = replies[0]?.[0];
  if (body.split(command).length !== 2 || replies.length !== 1)
    throw new Error('Le protocole interactif de Prime Agent a changé. Mettez à jour le Studio.');
  const patched = body
    .replace(
      command,
      `case "studio_wait_for_completion":
                return success(id, command.type, await connection.waitForHeadlessCompletion({ waitForRlmQuiescence: true }));
            ${command}`,
    )
    .replace(
      reply,
      `try {
                await connection.respondToExtensionUiRequest(response.id, daemonResponse);
                output(success(response.id, "extension_ui_response"));
            } catch (cause) {
                output(error(response.id, "extension_ui_response", String(cause)));
            }`,
    );
  return {
    changed: true,
    source: source.slice(0, match.index) + patched + source.slice(match.index + body.length),
  };
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!packageRoot || !url.startsWith('file:') || result.format !== 'module') return result;
  const path = relative(packageRoot, fileURLToPath(url)).replaceAll('\\', '/');
  const unbundled = path === 'dist/modes/rpc/rpc-mode.js';
  if (!unbundled && !/^dist\/bundle\/[^/]+\.m?js$/.test(path)) return result;
  const source =
    typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  const change = transformStudioRpc(source, { required: unbundled });
  return change.changed ? { ...result, source: change.source } : result;
}
