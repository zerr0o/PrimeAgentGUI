import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT, isDirectInvocation, writeJson } from './launcher-common.mjs';
import { enableTailscale } from './enable-tailscale.mjs';
import { validatePwaOrigin } from '../lib/pwa.mjs';

const execFileAsync = promisify(execFile);
async function tailscale(args) {
  const installed = join(process.env.ProgramFiles || 'C:/Program Files', 'Tailscale', 'tailscale.exe');
  const binary = process.platform === 'win32' && existsSync(installed) ? installed : 'tailscale';
  try {
    return (
      await execFileAsync(binary, args, {
        windowsHide: true,
        shell: false,
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout;
  } catch (error) {
    throw new Error([error.stdout, error.stderr, error.message].filter(Boolean).join('\n').trim());
  }
}

// Only configure our root handler. Existing services and public Funnel routes are never overwritten.
export async function enablePwa({
  root = APP_ROOT,
  runTailscale = tailscale,
  gatewayPort = 3090,
  setupTailscale = enableTailscale,
} = {}) {
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535)
    throw new Error('Port de passerelle PWA invalide.');
  const status = JSON.parse(await runTailscale(['status', '--json']));
  if (status.BackendState !== 'Running' || !status.Self?.DNSName || !status.CurrentTailnet?.MagicDNSEnabled)
    throw new Error('Connectez Tailscale avec MagicDNS activé avant de configurer la PWA.');
  const origin = validatePwaOrigin(`https://${status.Self.DNSName.replace(/\.$/, '').toLowerCase()}`);
  const authority = new URL(origin).hostname + ':443';
  const target = `http://127.0.0.1:${gatewayPort}`;
  const serve = JSON.parse(await runTailscale(['serve', 'status', '--json']));
  if (serve.AllowFunnel?.[authority])
    throw new Error('Une configuration Funnel publique existe sur cette adresse. Elle a été conservée.');
  const handlers = serve.Web?.[authority]?.Handlers;
  if (handlers && (Object.keys(handlers).length !== 1 || handlers['/']?.Proxy !== target))
    throw new Error(
      'Le port HTTPS Tailscale est déjà utilisé par un autre service. Configuration conservée.',
    );
  if (serve.TCP?.['443'] && serve.TCP['443'].HTTPS !== true)
    throw new Error('Le port Tailscale 443 est déjà utilisé. Configuration conservée.');

  const path = join(root, '.local', 'lan-access.json');
  let setup, config;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    setup = await setupTailscale({ root });
    config = JSON.parse(await readFile(path, 'utf8'));
  }
  if (!/^[a-f0-9]{64}$/.test(config.codeHash || '') || !/^[a-f0-9]{32}$/.test(config.salt || ''))
    throw new Error('Le code d’accès existant est invalide. Configuration conservée.');
  const runningServer = await readFile(join(root, '.local', 'server.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if ([config.port, runningServer?.port, Number(process.env.PORT || 3088)].includes(gatewayPort))
    throw new Error('La passerelle PWA doit utiliser un port distinct du Studio et du LAN.');
  const previous = JSON.parse(JSON.stringify(config));
  config.tailscale = { ...config.tailscale, https: { enabled: true, origin, port: gatewayPort } };
  await mkdir(join(root, '.local'), { recursive: true });
  await writeJson(path, config);
  try {
    await runTailscale(['serve', '--bg', '--yes', '--https=443', target]);
    const current = JSON.parse(await runTailscale(['serve', 'status', '--json']));
    if (current.Web?.[authority]?.Handlers?.['/']?.Proxy !== target || current.AllowFunnel?.[authority])
      throw new Error('Tailscale ne confirme pas la passerelle privée attendue.');
  } catch (error) {
    // Keep previous access settings if HTTPS activation needs an account-level step.
    await writeJson(path, previous);
    throw error;
  }
  return {
    url: origin,
    gatewayPort,
    codePreserved: !setup?.code,
    ...(setup?.code ? { code: setup.code } : {}),
    restartRequired: true,
  };
}
if (isDirectInvocation(import.meta.url)) {
  try {
    console.log(JSON.stringify(await enablePwa(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
