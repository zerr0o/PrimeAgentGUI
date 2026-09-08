import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createTailscaleHttps, tailscaleSetupUrl } from '../lib/tailscale-https.mjs';
import { fakeTailscale } from './fixtures/tailscale.mjs';
import { preferencesFixture } from '../scripts/preview-preferences.mjs';

async function fixture(t) {
  const f = await preferencesFixture();
  t.after(() => f.close());
  const change = async (body) => {
    const response = await fetch(f.url + '/api/remote-access/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: (await f.app.remoteAccess.get()).revision, ...body }),
    });
    return { status: response.status, data: await response.json() };
  };
  return { ...f, change };
}
test('HTTPS can be enabled alone, moved, disabled and re-enabled without rotating the PIN or starting an agent', async (t) => {
  const f = await fixture(t),
    pid = f.app.server.address().port;
  const first = await f.change({ channel: 'https', enabled: true });
  assert.equal(first.status, 200);
  assert.match(first.data.generatedCode, /^[0-9]{8}$/);
  assert.equal(first.data.channels[0].enabled, false);
  assert.equal(first.data.channels[1].enabled, false);
  assert.equal(first.data.channels[2].status, 'active');
  assert.equal(first.data.channels[2].url, f.tailscale.origin);
  const config = (await f.app.remoteAccess.readConfig()).config;
  const qr = await f.app.remoteNetwork.qr('https');
  assert.equal(qr.url, f.tailscale.origin);
  assert.match(qr.image, /^data:image\/png;base64,/);
  const moved = await f.change({ channel: 'https', enabled: true, port: 4190 });
  assert.equal(moved.status, 200);
  assert.equal(
    f.tailscale.getServe().Web['studio.taildemo.ts.net:443'].Handlers['/'].Proxy,
    'http://127.0.0.1:4190',
  );
  assert.equal((await f.change({ channel: 'https', enabled: false })).status, 200);
  await assert.rejects(f.app.remoteNetwork.qr('https'), { status: 409 });
  const again = await f.change({ channel: 'https', enabled: true });
  assert.equal(again.status, 200);
  assert.equal(again.data.generatedCode, undefined);
  assert.equal((await f.app.remoteAccess.readConfig()).config.codeHash, config.codeHash);
  assert.equal(f.app.server.address().port, pid);
  assert.equal(f.app.runs.size, 0);
});
test('approval and MagicDNS steps return only validated links and preserve existing LAN configuration', async (t) => {
  const f = await fixture(t);
  await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42', port: 3089 });
  const before = await readFile(f.app.remoteAccess.file, 'utf8');
  for (const [mode, link] of [
    ['approval', 'https://login.tailscale.com/f/serve?node=demo'],
    ['dns', 'https://login.tailscale.com/admin/dns'],
    ['offline', undefined],
    ['missing', undefined],
  ]) {
    f.tailscale.setMode(mode);
    const result = await f.change({ channel: 'https', enabled: true });
    assert.equal(result.status, 409);
    assert.equal(result.data.setupUrl, link);
    assert.equal(await readFile(f.app.remoteAccess.file, 'utf8'), before);
    assert.equal((await f.app.remoteNetwork.get()).channels[0].status, 'active');
  }
  f.tailscale.setMode('ready');
  assert.equal((await f.change({ channel: 'https', enabled: true })).status, 200);
  for (const value of [
    'https://evil.example/f/serve',
    'http://login.tailscale.com/admin/dns',
    'https://login.tailscale.com.evil.example/f/serve',
    'https://x@login.tailscale.com/f/serve',
    'https://login.tailscale.com:8443/f/serve',
    'javascript:alert(1)',
    'https://login.tailscale.com/admin/machines',
  ])
    assert.equal(tailscaleSetupUrl(value), null);
});
test('other services and Funnel are never replaced; invalid loopback port leaves Serve untouched', async (t) => {
  const f = await fixture(t);
  for (const serve of [
    { Web: { 'studio.taildemo.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } },
    { AllowFunnel: { 'studio.taildemo.ts.net:443': true } },
    { TCP: { 443: { TCPForward: 'localhost:80' } } },
    { Web: { 'other.taildemo.ts.net:443': { Handlers: { '/': { Text: 'other' } } } } },
  ]) {
    f.tailscale.setServe(serve);
    assert.equal((await f.change({ channel: 'https', enabled: true })).status, 409);
    assert.deepEqual(f.tailscale.getServe(), serve);
    assert.equal((await f.app.remoteAccess.get()).configured, false);
  }
  f.tailscale.setServe({});
  const result = await f.change({ channel: 'https', enabled: true, port: f.app.server.address().port });
  assert.equal(result.status, 400);
  assert.deepEqual(f.tailscale.getServe(), {});
  assert.equal(
    f.tailscale.calls.some((args) => args.includes('--bg')),
    false,
  );
});
test('a persistence conflict rolls back only the staged Serve handler and preserves the working LAN', async (t) => {
  const f = await fixture(t);
  await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42', port: 3089 });
  const previous = await readFile(f.app.remoteAccess.file, 'utf8');
  // Inject an external write precisely after Serve setup, before the atomic config revision check.
  const originalRun = f.tailscale.run;
  const service = createTailscaleHttps({
    run: async (args) => {
      const result = await originalRun(args);
      if (args.includes('--bg') && args.at(-1) !== 'off')
        await writeFile(f.app.remoteAccess.file, previous + ' ');
      return result;
    },
  });
  const state = await f.app.remoteAccess.get();
  await assert.rejects(
    f.app.remoteAccess.updateConfig({
      revision: state.revision,
      build: async (config) => ({ ...config, tailscale: { https: { enabled: true } } }),
      prepare: async () => {
        const operation = await service.prepare(3090);
        await operation.activate();
        return { commit() {}, rollback: operation.rollback };
      },
    }),
    { status: 409 },
  );
  assert.deepEqual(f.tailscale.getServe(), {});
  assert.equal(await readFile(f.app.remoteAccess.file, 'utf8'), previous + ' ');
  assert.equal((await f.app.remoteNetwork.get()).channels[0].status, 'active');
});
test('rollback preserves unrelated new services and restores the old target when moving our own gateway', async () => {
  const cli = fakeTailscale(),
    service = createTailscaleHttps({ run: cli.run });
  const initial = await service.prepare(3090);
  await initial.activate();
  const changed = await service.prepare(4190, { origin: cli.origin, port: 3090 });
  await changed.activate();
  await changed.rollback();
  assert.equal(cli.getServe().Web['studio.taildemo.ts.net:443'].Handlers['/'].Proxy, 'http://127.0.0.1:3090');
  const move = await service.prepare(4190, { origin: cli.origin, port: 3090 });
  await move.activate();
  const external = {
    Web: { 'studio.taildemo.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9876' } } } },
  };
  cli.setServe(external);
  await assert.rejects(move.rollback(), { status: 409 });
  assert.deepEqual(cli.getServe(), external);
});

test('a matching proxy without a TLS listener is not reported as active', async () => {
  const cli = fakeTailscale();
  cli.setServe({
    Web: { 'studio.taildemo.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3090' } } } },
  });
  const service = createTailscaleHttps({ run: cli.run });
  assert.ok((await service.verify(cli.origin, 3090)).error);
  const change = await service.prepare(3090);
  await assert.rejects(change.activate(), { status: 409 });
});

test('HTTPS changes preserve an active run and the local server instance', async (t) => {
  let finish,
    cancelled = 0;
  const f = await preferencesFixture({
    runtime: {
      getStatus: async () => ({ available: true }),
      getModels: async () => ({ models: [] }),
      start: async () => ({
        done: new Promise((resolve) => (finish = resolve)),
        cancel: async () => {
          cancelled++;
          finish({ status: 'stopped' });
        },
      }),
      close: async () => finish?.({ status: 'completed' }),
    },
  });
  t.after(() => f.close());
  const bootstrap = await (await fetch(f.url + '/api/bootstrap')).json();
  const response = await fetch(f.url + '/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: bootstrap.projects[0].cwd, message: 'Keep working' }),
  });
  assert.equal(response.status, 201);
  const run = await response.json();
  for (const enabled of [true, false, true]) {
    await f.app.remoteNetwork.configure({
      channel: 'https',
      enabled,
      revision: (await f.app.remoteAccess.get()).revision,
    });
    assert.equal(f.app.runs.get(run.id).status, 'running');
    assert.equal(cancelled, 0);
  }
});
