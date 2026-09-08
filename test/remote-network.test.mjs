import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server.mjs';
import { createLanGateway, hashAccessCode } from '../lib/lan.mjs';
import { networkAddresses } from '../lib/remote-network.mjs';

const interfaces = () => ({
  'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
  Tailscale: [{ family: 'IPv4', internal: false, address: '100.91.42.10' }],
});
function http(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((done, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(text);
        } catch {}
        done({ status: res.statusCode, headers: res.headers, json, text });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}
async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'prime-network-test-')),
    cwd = join(temp, 'project');
  await mkdir(cwd);
  let cancellations = 0,
    finish,
    failHost;
  const gateways = [],
    topology = { value: interfaces() };
  const app = createApp({
    initialCwd: cwd,
    agentHome: join(temp, 'agent'),
    sessionDir: join(temp, 'sessions'),
    dataDir: join(temp, 'data'),
    runtime: {
      getStatus: async () => ({ available: true }),
      getModels: async () => ({ models: [] }),
      start: async () => ({
        done: new Promise((done) => (finish = done)),
        cancel: async () => {
          cancellations++;
          finish({ status: 'stopped' });
        },
      }),
      close: async () => finish?.({ status: 'completed' }),
    },
    networkOptions: {
      httpsService: { verify: async () => ({}) },
      interfaces: () => topology.value,
      makeGateway: (options) => {
        if (options.host === failHost) {
          const stub = new EventEmitter();
          stub.close = () => {};
          stub.listen = () =>
            queueMicrotask(() =>
              stub.emit('error', Object.assign(new Error('busy'), { code: 'EADDRINUSE' })),
            );
          return stub;
        }
        const gateway = createLanGateway(options),
          listen = gateway.listen.bind(gateway);
        gateway.listen = (_port, _host, callback) => listen(0, '127.0.0.1', callback);
        gateways.push({ gateway, host: options.host });
        return gateway;
      },
    },
  });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    await app.close();
    assert.equal(dirname(temp), resolve(tmpdir()));
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const api = (path, body) =>
    http(
      app.server.address().port,
      path,
      body
        ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
        : {},
    );
  const change = async (body) =>
    api('/api/remote-access/network', { revision: (await app.remoteAccess.get()).revision, ...body });
  return {
    app,
    api,
    change,
    cwd,
    gateways,
    topology,
    get cancellations() {
      return cancellations;
    },
    fail: (host) => (failHost = host),
  };
}

test('network discovery excludes public, virtual and internal addresses', () => {
  assert.deepEqual(
    networkAddresses({
      ...interfaces(),
      WSL: [{ family: 'IPv4', address: '172.16.1.2' }],
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      Public: [
        { family: 'IPv4', address: '8.8.8.8' },
        { family: 'IPv6', address: '::1' },
      ],
    }),
    {
      lan: [{ name: 'Wi-Fi', address: '192.168.1.42' }],
      tailscale: [{ name: 'Tailscale', address: '100.91.42.10' }],
    },
  );
});

test('hot LAN/Tailscale changes preserve PIN and running agents; QR uses only the active URL', async (t) => {
  const f = await fixture(t),
    before = (await f.api('/api/health')).json;
  const run = await f.api('/api/runs', { cwd: f.cwd, message: 'Keep working' });
  assert.equal(run.status, 201);
  assert.equal((await f.api('/api/remote-access/network')).json.configured, false);
  const enabled = await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42' });
  assert.equal(enabled.status, 200);
  assert.match(enabled.json.generatedCode, /^[0-9]{8}$/);
  assert.equal(enabled.json.channels[0].status, 'active');
  const stored = (await f.app.remoteAccess.readConfig()).config;
  assert.equal(stored.codeHash, hashAccessCode(enabled.json.generatedCode, stored.salt));
  assert.ok(!(await readFile(f.app.remoteAccess.file, 'utf8')).includes(enabled.json.generatedCode));
  const tail = await f.change({ channel: 'tailscale', enabled: true, host: '100.91.42.10' });
  assert.equal(tail.status, 200);
  assert.equal(tail.json.generatedCode, undefined);
  const qr = await f.api('/api/remote-access/qr?channel=tailscale');
  assert.equal(qr.json.url, 'http://100.91.42.10:3089');
  assert.match(qr.json.image, /^data:image\/png;base64,/);
  assert.equal((await f.api('/api/remote-access/qr?channel=https://evil.example')).status, 409);
  const lanGateway = f.gateways[0].gateway;
  assert.equal((await f.change({ channel: 'lan', enabled: false })).status, 200);
  assert.equal(lanGateway.listening, false);
  assert.equal(f.gateways[1].gateway.listening, true);
  assert.equal((await f.api('/api/remote-access/qr?channel=lan')).status, 409);
  assert.equal(
    (await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42' })).json.generatedCode,
    undefined,
  );
  assert.equal((await f.app.remoteAccess.readConfig()).config.codeHash, stored.codeHash);
  assert.equal(f.cancellations, 0);
  assert.equal(f.app.runs.get(run.json.id).status, 'running');
  assert.equal((await f.api('/api/health')).json.instanceId, before.instanceId);
  assert.doesNotMatch(
    JSON.stringify((await f.api('/api/remote-access/network')).json),
    /codeHash|salt|generatedCode/,
  );
});

test('failed activation and stale revisions leave the working connection and configuration intact', async (t) => {
  const f = await fixture(t);
  await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42' });
  const original = await readFile(f.app.remoteAccess.file, 'utf8');
  f.fail('100.91.42.10');
  assert.equal((await f.change({ channel: 'tailscale', enabled: true, host: '100.91.42.10' })).status, 409);
  assert.equal(await readFile(f.app.remoteAccess.file, 'utf8'), original);
  assert.equal(f.gateways[0].gateway.listening, true);
  for (const body of [
    { host: '0.0.0.0' },
    { host: '8.8.8.8' },
    { port: 80 },
    { port: f.app.server.address().port },
    { surprise: true },
  ])
    assert.equal(
      (await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42', ...body })).status,
      400,
    );
  assert.equal((await f.change({ channel: 'lan', enabled: false, revision: 'a'.repeat(64) })).status, 409);
  assert.equal(await readFile(f.app.remoteAccess.file, 'utf8'), original);
});

test('remote gateways forbid local settings APIs and permission changes revoke cookies without cancelling runs', async (t) => {
  const f = await fixture(t);
  const run = await f.api('/api/runs', { cwd: f.cwd, message: 'Keep working' });
  const enabled = await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42' });
  const { gateway, host } = f.gateways[0],
    port = gateway.address().port;
  const login = () =>
    http(port, '/lan/login', {
      method: 'POST',
      headers: { Host: `${host}:${port}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `code=${enabled.json.generatedCode}`,
    });
  const signed = await login();
  assert.equal(signed.status, 303);
  let cookie = signed.headers['set-cookie'][0].split(';')[0];
  const remote = (path, body) =>
    http(port, path, {
      headers: {
        Host: `${host}:${port}`,
        Cookie: cookie,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
  for (const path of ['/api/remote-access/network', '/api/remote-access/qr?channel=lan', '/api/system'])
    assert.equal((await remote(path)).status, 404);
  assert.equal((await remote('/api/remote-access/network', { channel: 'lan', enabled: false })).status, 404);
  assert.equal((await remote('/api/system/logs', {})).status, 404);
  assert.equal((await f.change({ channel: 'permissions', readOnly: true })).status, 200);
  assert.equal((await remote('/api/bootstrap')).status, 401);
  cookie = (await login()).headers['set-cookie'][0].split(';')[0];
  assert.equal((await remote('/api/bootstrap')).json.preferences.readOnly, true);
  assert.equal((await remote('/api/runs', { cwd: f.cwd, message: 'not allowed' })).status, 405);
  assert.equal(f.cancellations, 0);
  assert.equal(f.app.runs.get(run.json.id).status, 'running');
});

test('an unavailable Tailscale connection does not prevent disabling LAN or changing permissions', async (t) => {
  const f = await fixture(t);
  await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42' });
  const saved = (await f.app.remoteAccess.readConfig()).config;
  saved.tailscale = { enabled: true, host: '100.91.42.10' };
  saved.custom = { preserved: true };
  await writeFile(f.app.remoteAccess.file, JSON.stringify(saved));
  f.fail('100.91.42.10');
  await f.app.remoteNetwork.start();
  assert.equal((await f.app.remoteNetwork.get()).channels[1].status, 'error');
  assert.equal((await f.change({ channel: 'permissions', readOnly: true })).status, 200);
  assert.equal((await f.change({ channel: 'lan', enabled: false })).status, 200);
  assert.deepEqual((await f.app.remoteAccess.readConfig()).config.custom, { preserved: true });
});

test('status reports lost addresses and external configuration changes instead of advertising an inactive URL', async (t) => {
  const f = await fixture(t);
  await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42' });
  await f.change({ channel: 'tailscale', enabled: true, host: '100.91.42.10' });
  const saved = (await f.app.remoteAccess.readConfig()).config;
  saved.port = 4189;
  await writeFile(f.app.remoteAccess.file, JSON.stringify(saved));
  const drifted = await f.app.remoteNetwork.get();
  assert.equal(drifted.channels[0].status, 'error');
  assert.equal(drifted.channels[0].url, null);
  const applied = await f.change({ channel: 'lan', enabled: true, host: '192.168.1.42', port: 4189 });
  assert.equal(applied.json.channels[1].status, 'active');
  assert.equal(applied.json.channels[1].url, 'http://100.91.42.10:4189');
  f.topology.value = {};
  const state = await f.app.remoteNetwork.get();
  assert.equal(state.channels[0].status, 'error');
  assert.equal(state.channels[0].url, null);
  assert.equal((await f.api('/api/remote-access/qr?channel=lan')).status, 409);
});

test('startup restores LAN, Tailscale and existing HTTPS; concurrent PIN and network writes cannot overwrite each other', async (t) => {
  const f = await fixture(t),
    code = '12345678',
    salt = 'c'.repeat(32);
  await mkdir(dirname(f.app.remoteAccess.file), { recursive: true });
  await writeFile(
    f.app.remoteAccess.file,
    JSON.stringify({
      enabled: true,
      host: '192.168.1.42',
      port: 3089,
      readOnly: false,
      salt,
      codeHash: hashAccessCode(code, salt),
      tailscale: {
        enabled: true,
        host: '100.91.42.10',
        https: { enabled: true, port: 3090, origin: 'https://studio.example.ts.net' },
      },
    }),
  );
  assert.equal(f.gateways.length, 0);
  await f.app.remoteNetwork.start();
  const state = await f.app.remoteNetwork.get();
  assert.deepEqual(
    state.channels.map((entry) => entry.status),
    ['active', 'active', 'active'],
  );
  assert.equal((await f.app.remoteNetwork.qr('https')).url, 'https://studio.example.ts.net');
  const results = await Promise.allSettled([
    f.app.remoteAccess.changeCode({ code: '01234567', confirmation: '01234567', revision: state.revision }),
    f.app.remoteNetwork.configure({ channel: 'lan', enabled: false, revision: state.revision }),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.status, 409);
  const saved = (await f.app.remoteAccess.readConfig()).config;
  assert.equal(saved.enabled, true);
  assert.equal(saved.codeHash, hashAccessCode('01234567', saved.salt));
  assert.equal((await f.change({ channel: 'lan', enabled: false })).status, 200);
  assert.equal(f.gateways[2].gateway.listening, true);
});
