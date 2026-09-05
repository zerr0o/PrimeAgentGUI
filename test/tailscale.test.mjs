import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  createLanGateway,
  hashAccessCode,
  isPrivateIPv4,
  isTailscaleIPv4,
  isGatewayPeerAllowed,
} from '../lib/lan.mjs';
import { enableTailscale } from '../scripts/enable-tailscale.mjs';

const host = '100.100.20.30';
const interfaces = { Tailscale: [{ family: 'IPv4', address: host, internal: false }] };
const code = '12345678';
const config = {
  enabled: true,
  host: '192.168.1.20',
  port: 3089,
  readOnly: false,
  salt: 'a'.repeat(32),
  codeHash: hashAccessCode(code, 'a'.repeat(32)),
};
test('Tailscale CGNAT bounds are exact and remain separate from LAN addresses', () => {
  for (const address of ['100.64.0.0', host, '100.127.255.255']) {
    assert.equal(isTailscaleIPv4(address), true);
    assert.equal(isPrivateIPv4(address), false);
    assert.equal(isGatewayPeerAllowed(host, address), true);
    assert.equal(isGatewayPeerAllowed('192.168.1.20', address), false);
  }
  for (const address of [
    '100.63.255.255',
    '100.128.0.0',
    '100.100.256.1',
    '100.100.1',
    '100.100.01.1',
    '8.8.8.8',
    '0.0.0.0',
    '192.168.1.20',
    '::1',
    '100.100.1.2.evil',
  ]) {
    assert.equal(isTailscaleIPv4(address), false, address);
    assert.equal(isGatewayPeerAllowed(host, address), false, address);
  }
  assert.equal(isGatewayPeerAllowed(host, '127.0.0.1'), true);
});

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'prime-tailscale-test-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, '.local'));
  return root;
}
test('enabling Tailscale preserves LAN, code, port, permissions and unrelated preferences', async (t) => {
  const root = await temporary(t),
    file = join(root, '.local', 'lan-access.json');
  const previous = { ...config, readOnly: true, port: 3091, preference: 'keep' };
  await writeFile(file, JSON.stringify(previous));
  const result = await enableTailscale({ root, interfaces });
  assert.deepEqual(result, { url: `http://${host}:3091`, codePreserved: true, restartRequired: true });
  assert.deepEqual(JSON.parse(await readFile(file)), { ...previous, tailscale: { enabled: true, host } });
  assert.deepEqual(await enableTailscale({ root, interfaces }), result);
});
test('first-time setup creates authenticated Tailscale access without enabling LAN', async (t) => {
  const root = await temporary(t);
  const result = await enableTailscale({ root, interfaces });
  const saved = JSON.parse(await readFile(join(root, '.local', 'lan-access.json')));
  assert.equal(saved.enabled, false);
  assert.equal(saved.codeHash, hashAccessCode(result.code, saved.salt));
  assert.equal(saved.tailscale.host, host);
});
test('missing Tailscale interface or corrupt configuration is left untouched', async (t) => {
  const root = await temporary(t),
    file = join(root, '.local', 'lan-access.json');
  await writeFile(file, JSON.stringify(config));
  await assert.rejects(
    enableTailscale({ root, interfaces: { Ethernet: interfaces.Tailscale } }),
    /interface Tailscale/,
  );
  assert.deepEqual(JSON.parse(await readFile(file)), config);
  await writeFile(file, '{broken');
  await assert.rejects(enableTailscale({ root, interfaces }));
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('Tailscale HTTP gateway requires the code, allows control and SSE, rejects other origins and local-only routes', async (t) => {
  const calls = [];
  const upstream = createServer((req, res) => {
    calls.push({ method: req.method, url: req.url });
    if (req.url.endsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end('data: {"kind":"text","delta":"ok"}\n\n');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/bootstrap' ? { preferences: {} } : { accepted: true }));
  });
  await new Promise((done) => upstream.listen(0, '127.0.0.1', done));
  const gateway = createLanGateway({ host, upstreamPort: upstream.address().port, config });
  t.after(async () => {
    for (const server of [gateway, upstream]) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });
  await new Promise((done) => gateway.listen(0, '127.0.0.1', done));
  const authority = `${host}:${gateway.address().port}`;
  const http = (path, options = {}) =>
    new Promise((done, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: gateway.address().port,
          path,
          method: options.method || 'GET',
          headers: { host: authority, ...options.headers },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
        },
      );
      req.on('error', reject);
      req.end(options.body);
    });
  assert.equal((await http('/api/bootstrap')).status, 401);
  assert.equal((await http('/', { headers: { host: 'evil.example' } })).status, 403);
  const login = await http('/lan/login', {
    method: 'POST',
    headers: { origin: `http://${authority}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: `code=${code}`,
  });
  assert.equal(login.status, 303);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const headers = { cookie, origin: `http://${authority}`, 'content-type': 'application/json' };
  const bootstrap = await http('/api/bootstrap', { headers });
  assert.deepEqual(JSON.parse(bootstrap.body).preferences, { remote: true, readOnly: false });
  assert.equal(
    (await http('/api/runs', { method: 'POST', headers, body: '{"message":"demo"}' })).status,
    200,
  );
  assert.equal(
    (await http('/api/live/sessions/demo/messages', { method: 'POST', headers, body: '{"message":"demo"}' }))
      .status,
    200,
  );
  assert.match((await http('/api/runs/abcdef/events', { headers })).body, /"delta":"ok"/);
  assert.equal(
    (
      await http('/api/runs', {
        method: 'POST',
        headers: { ...headers, origin: 'http://evil.example' },
        body: '{}',
      })
    ).status,
    403,
  );
  for (const path of ['/api/health', '/api/model-config', '/api/model-defaults'])
    assert.equal((await http(path, { headers })).status, 404);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 2);
});
