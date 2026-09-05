import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server.mjs';
import { createLanGateway, hashAccessCode } from '../lib/lan.mjs';
import { PWA_PUBLIC_PATHS, validatePwaOrigin } from '../lib/pwa.mjs';
import { enablePwa } from '../scripts/enable-pwa.mjs';

const origin = 'https://studio.tailtest.ts.net';
const code = '12345678',
  salt = 'a'.repeat(32);
const config = {
  enabled: true,
  host: '192.168.1.20',
  port: 3089,
  readOnly: false,
  salt,
  codeHash: hashAccessCode(code, salt),
  tailscale: { enabled: true, host: '100.100.1.20' },
};
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'prime-pwa-'));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, '.local'));
  return dir;
}
async function fixture(t, permissions = {}) {
  const dir = await temporary(t);
  await Promise.all([mkdir(join(dir, 'sessions')), mkdir(join(dir, 'agent'))]);
  const app = createApp({
    sessionDir: join(dir, 'sessions'),
    agentHome: join(dir, 'agent'),
    dataDir: join(dir, '.local'),
    initialCwd: dir,
    runtime: {
      async getStatus() {
        return { available: true, version: 'fixture' };
      },
      async getModels() {
        return { models: [], default: {} };
      },
      async close() {},
      async start() {
        throw new Error('No agents in this test.');
      },
    },
  });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  const gateway = createLanGateway({
    host: '127.0.0.1',
    upstreamPort: app.server.address().port,
    config: { ...config, ...permissions },
    publicOrigin: origin,
  });
  await new Promise((done) => gateway.listen(0, '127.0.0.1', done));
  t.after(async () => {
    gateway.closeAllConnections();
    await new Promise((done) => gateway.close(done));
    await app.close();
  });
  const api = (path, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((done, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: gateway.address().port,
          path,
          method,
          headers: { Host: new URL(origin).host, ...headers },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            done({
              status: res.statusCode,
              headers: res.headers,
              data: Buffer.concat(chunks),
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  const login = () =>
    api('/lan/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `code=${code}`,
    });
  return { api, login, app, dir, gateway };
}
test('PWA origin accepts only an exact HTTPS Tailscale hostname on a loopback gateway', () => {
  assert.equal(validatePwaOrigin(origin), origin);
  for (const bad of [
    origin + '/',
    origin + ':443',
    origin + '/path',
    origin + '?x=1',
    origin.replace('https:', 'http:'),
    'https://evil.com',
    'https://studio.tailtest.ts.net.evil.com',
    'https://user@studio.tailtest.ts.net',
  ])
    assert.throws(() => validatePwaOrigin(bad));
  assert.throws(() => createLanGateway({ host: '100.100.1.20', config, publicOrigin: origin }), /loopback/);
});
test('install resources are public and correctly typed; all session data still requires login', async (t) => {
  const { api } = await fixture(t);
  const landing = await api('/');
  assert.match(landing.text, /pwa-install/);
  assert.match(landing.text, /manifest.webmanifest/);
  assert.match(landing.text, /Accès privé · Tailscale · HTTPS/);
  assert.doesNotMatch(landing.text, /réseau local/);
  for (const path of PWA_PUBLIC_PATHS) assert.equal((await api(path)).status, 200, path);
  const manifest = await api('/manifest.webmanifest');
  assert.match(manifest.headers['content-type'], /application\/manifest\+json/);
  const definition = JSON.parse(manifest.text);
  assert.equal(definition.display, 'standalone');
  assert.equal(definition.start_url, '/');
  for (const size of [180, 192, 512]) {
    const icon = await api(`/assets/prime-agent-${size}.png`);
    assert.equal(icon.data.readUInt32BE(16), size);
    assert.equal(icon.data.readUInt32BE(20), size);
  }
  assert.match((await api('/service-worker.js')).headers['content-type'], /javascript/);
  for (const path of [
    '/api/bootstrap',
    '/api/history?id=secret',
    '/api/runs',
    '/api/files/00000000-0000-4000-8000-000000000000',
    '/public/app.js',
    '/public/manifest.webmanifest',
    '/assets/unknown.png',
  ])
    assert.equal((await api(path)).status, 401, path);
  assert.equal((await api('/manifest.webmanifest', { method: 'POST' })).status, 401);
});
test('HTTPS keeps secure access cookies, full-control permissions and exact Host/Origin checks', async (t) => {
  const { api, login, dir } = await fixture(t);
  const navigation = {
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'empty',
  };
  for (const path of ['/', '/index.html']) {
    const landing = await api(path, { headers: navigation });
    assert.equal(landing.status, 200);
    assert.match(landing.text, /Code d’accès/);
  }
  const signedIn = await login();
  assert.equal(signedIn.status, 303);
  assert.match(signedIn.headers['set-cookie'][0], /; Secure/);
  assert.match(signedIn.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  const cookie = signedIn.headers['set-cookie'][0].split(';')[0];
  assert.equal((await api('/', { headers: { ...navigation, Host: 'evil.com' } })).status, 403);
  assert.equal((await api('/', { headers: { ...navigation, Origin: 'null' } })).status, 403);
  assert.equal((await api('/api/bootstrap', { headers: { ...navigation, cookie } })).status, 403);
  const bootstrap = JSON.parse((await api('/api/bootstrap', { headers: { cookie } })).text);
  assert.equal(bootstrap.preferences.remote, true);
  assert.equal(bootstrap.preferences.readOnly, false);
  for (const path of ['/api/model-config', '/api/model-defaults', '/api/health', '/server.mjs'])
    assert.equal((await api(path, { headers: { cookie } })).status, 404);
  assert.equal(
    (
      await api('/api/projects', {
        method: 'POST',
        headers: { cookie, Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: dir }),
      })
    ).status,
    201,
  );
  for (const headers of [
    { Origin: 'https://evil.com' },
    { Host: 'evil.com' },
    { Origin: origin.replace('https:', 'http:') },
    { 'Sec-Fetch-Site': 'cross-site' },
  ])
    assert.equal((await api('/api/bootstrap', { headers: { cookie, ...headers } })).status, 403);
  assert.equal(
    (
      await api('/api/bootstrap', {
        headers: {
          cookie,
          Host: 'evil.com',
          'X-Forwarded-Host': new URL(origin).host,
          'X-Forwarded-Proto': 'https',
        },
      })
    ).status,
    403,
  );
});
test('read-only HTTPS sessions keep installation available and refuse commands', async (t) => {
  const { api, login } = await fixture(t, { readOnly: true });
  const cookie = (await login()).headers['set-cookie'][0].split(';')[0];
  assert.equal((await api('/manifest.webmanifest')).status, 200);
  assert.equal(
    (
      await api('/api/runs', {
        method: 'POST',
        headers: { cookie, Origin: origin, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    405,
  );
});

async function setupFixture(t) {
  const root = await temporary(t),
    path = join(root, '.local', 'lan-access.json');
  await writeFile(path, JSON.stringify(config));
  let serve = {};
  const calls = [];
  const runTailscale = async (args) => {
    calls.push(args);
    if (args[0] === 'status')
      return JSON.stringify({
        BackendState: 'Running',
        CurrentTailnet: { MagicDNSEnabled: true },
        Self: { DNSName: 'studio.tailtest.ts.net.' },
      });
    if (args[1] === 'status') return JSON.stringify(serve);
    serve = {
      ...serve,
      Web: {
        ...serve.Web,
        'studio.tailtest.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3090' } } },
      },
      TCP: { ...serve.TCP, 443: { HTTPS: true } },
    };
    return '';
  };
  return {
    root,
    path,
    runTailscale,
    calls,
    setServe: (value) => {
      serve = value;
    },
  };
}
test('PWA setup preserves LAN/code and unrelated Serve routes, and can be run twice', async (t) => {
  const f = await setupFixture(t);
  f.setServe({ TCP: { 8443: { HTTPS: true } } });
  assert.deepEqual(await enablePwa(f), {
    url: origin,
    gatewayPort: 3090,
    codePreserved: true,
    restartRequired: true,
  });
  const saved = JSON.parse(await readFile(f.path));
  assert.deepEqual(saved, {
    ...config,
    tailscale: { ...config.tailscale, https: { enabled: true, origin, port: 3090 } },
  });
  await enablePwa(f);
  assert.ok(f.calls.some((args) => args.join(' ') === 'serve --bg --yes --https=443 http://127.0.0.1:3090'));
  assert.ok(!f.calls.some((args) => args.includes('reset') || args.includes('funnel')));
});
test('PWA setup refuses occupied HTTPS or public Funnel without changing access settings', async (t) => {
  const f = await setupFixture(t);
  for (const serve of [
    { Web: { 'studio.tailtest.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } } } },
    { AllowFunnel: { 'studio.tailtest.ts.net:443': true } },
    { TCP: { 443: { TCPForward: 'localhost:9000' } } },
  ]) {
    f.setServe(serve);
    await assert.rejects(enablePwa(f));
    assert.deepEqual(JSON.parse(await readFile(f.path)), config);
  }
});
test('failed HTTPS activation restores access settings and reports the required external step', async (t) => {
  const f = await setupFixture(t);
  const run = f.runTailscale;
  f.runTailscale = (args) => {
    if (args.includes('--bg')) throw new Error('Enable HTTPS in Tailscale');
    return run(args);
  };
  await assert.rejects(enablePwa(f), /Enable HTTPS/);
  assert.deepEqual(JSON.parse(await readFile(f.path)), config);
});
