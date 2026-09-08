import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from './store.mjs';
import { validatePwaOrigin } from './pwa.mjs';
import { formatMessage as tr } from '../public/i18n-core.js';

const exec = promisify(execFile);
export function tailscaleSetupUrl(value) {
  try {
    const url = new URL(value);
    return value.length <= 2048 &&
      url.protocol === 'https:' &&
      url.hostname === 'login.tailscale.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^\/(?:f\/serve(?:\/|$)|admin\/dns(?:\/|$))/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
async function runTailscale(args) {
  const installed = join(process.env.ProgramFiles || 'C:/Program Files', 'Tailscale', 'tailscale.exe');
  const binary = process.platform === 'win32' && existsSync(installed) ? installed : 'tailscale';
  return (
    await exec(binary, args, { windowsHide: true, shell: false, timeout: 20000, maxBuffer: 1024 * 1024 })
  ).stdout;
}
function failure(error) {
  if (error instanceof HttpError) return error;
  const output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
  for (const match of output.matchAll(/https:\/\/[^\s<>"']+/g)) {
    const setupUrl = tailscaleSetupUrl(match[0]);
    if (setupUrl) return Object.assign(new HttpError(409, tr('https.authorization')), { setupUrl });
  }
  return new HttpError(409, tr(error.code === 'ENOENT' ? 'https.not_installed' : 'https.failed'));
}
const targetFor = (port) => `http://127.0.0.1:${port}`;
export function createTailscaleHttps({ run = runTailscale } = {}) {
  let cached,
    until = 0;
  const invalidate = () => {
    cached = undefined;
    until = 0;
  };
  async function read() {
    try {
      const status = JSON.parse(await run(['status', '--json']));
      if (status.BackendState !== 'Running' || !status.Self?.DNSName)
        throw new HttpError(409, tr('https.connect'));
      if (!status.CurrentTailnet?.MagicDNSEnabled)
        throw Object.assign(new HttpError(409, tr('https.magicdns')), {
          setupUrl: 'https://login.tailscale.com/admin/dns',
        });
      const origin = validatePwaOrigin(`https://${status.Self.DNSName.replace(/\.$/, '').toLowerCase()}`);
      const serve = JSON.parse(await run(['serve', 'status', '--json']));
      return { origin, authority: new URL(origin).hostname + ':443', serve };
    } catch (error) {
      throw failure(error);
    }
  }
  function handler(state, permitted) {
    const { serve, authority } = state;
    const handlers = serve.Web?.[authority]?.Handlers;
    if (
      serve.AllowFunnel?.[authority] ||
      Object.keys(serve.Web || {}).some((host) => host !== authority && host.endsWith(':443')) ||
      (serve.TCP?.['443'] && serve.TCP['443'].HTTPS !== true) ||
      (handlers && (Object.keys(handlers).length !== 1 || !permitted.includes(handlers['/']?.Proxy)))
    )
      throw new HttpError(409, tr('https.conflict'));
    // A listener without the expected handler also belongs to another configuration.
    if (!handlers && serve.TCP?.['443']) throw new HttpError(409, tr('https.conflict'));
    return handlers?.['/']?.Proxy || null;
  }
  async function prepare(port, previous) {
    const initial = await read(),
      target = targetFor(port);
    const oldTarget = previous?.origin === initial.origin ? targetFor(previous.port) : null;
    const before = handler(initial, [target, oldTarget].filter(Boolean));
    let attempted = false;
    async function rollback() {
      if (!attempted || before === target) return;
      invalidate();
      const current = await read();
      if (current.origin !== initial.origin || handler(current, [target]) !== target) return;
      await run(
        before
          ? ['serve', '--bg', '--yes', '--https=443', before]
          : ['serve', '--bg', '--yes', '--https=443', 'off'],
      );
    }
    return {
      origin: initial.origin,
      async activate() {
        try {
          const current = await read();
          if (
            current.origin !== initial.origin ||
            handler(current, [target, oldTarget].filter(Boolean)) !== before
          )
            throw new HttpError(409, tr('https.changed'));
          if (before !== target) {
            attempted = true;
            await run(['serve', '--bg', '--yes', '--https=443', target]);
          }
          const verified = await read();
          if (
            verified.origin !== initial.origin ||
            verified.serve.TCP?.['443']?.HTTPS !== true ||
            handler(verified, [target]) !== target
          )
            throw new HttpError(409, tr('https.not_serving'));
          invalidate();
        } catch (error) {
          invalidate();
          try {
            await rollback();
          } catch {
            /* Never reset or overwrite an unrelated service. */
          }
          throw failure(error);
        }
      },
      rollback,
    };
  }
  async function verify(origin, port) {
    if (!cached || Date.now() >= until) {
      until = Date.now() + 8000;
      cached = read().catch((error) => ({ error: failure(error) }));
    }
    const state = await cached;
    if (state.error) return { error: state.error.message };
    try {
      if (
        state.origin !== origin ||
        state.serve.TCP?.['443']?.HTTPS !== true ||
        handler(state, [targetFor(port)]) !== targetFor(port)
      )
        throw new HttpError(409, tr('https.not_serving'));
      return {};
    } catch (error) {
      return { error: failure(error).message };
    }
  }
  return { prepare, verify };
}
