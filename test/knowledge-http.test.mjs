import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createKnowledgeFixture } from '../scripts/fixtures/knowledge.mjs';
import { createLanGateway, hashAccessCode } from '../lib/lan.mjs';

const CODE = '72936148';

async function nativeSnapshot(root, dir = root) {
  const files = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, await nativeSnapshot(root, path));
    else if (entry.isFile()) files[relative(root, path)] = await readFile(path, 'utf8');
  }
  return files;
}

function http(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
      });
      res.on('error', reject);
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function fixture(t) {
  const f = await createKnowledgeFixture();
  const upstreamPort = f.app.server.address().port;
  const salt = '684ded8f02d74a6292cd20a66cafc891';
  const gateway = createLanGateway({
    host: '127.0.0.1',
    upstreamPort,
    config: { salt, codeHash: hashAccessCode(CODE, salt), readOnly: true },
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const port = gateway.address().port;
  t.after(async () => {
    gateway.closeAllConnections();
    await new Promise((resolve, reject) => gateway.close((error) => (error ? reject(error) : resolve())));
    await f.close();
  });
  const local = (path, options) => http(upstreamPort, path, options);
  const remote = (path, options) => http(port, path, options);
  async function authenticate() {
    const login = await remote('/lan/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: CODE }).toString(),
    });
    assert.equal(login.status, 303, login.text);
    return login.headers['set-cookie'][0].split(';')[0];
  }
  const query = (args = {}) => '/api/knowledge?' + new URLSearchParams({ cwd: f.cwd, ...args });
  const item = (id, cwd = f.cwd) => '/api/knowledge/item?' + new URLSearchParams({ cwd, id });
  return { ...f, local, remote, authenticate, query, item };
}

test('LAN knowledge requires authentication and permits search/detail in consultation mode', async (t) => {
  const f = await fixture(t);
  const before = await nativeSnapshot(f.agentHome);
  for (const path of [f.query(), f.item('a'.repeat(64))]) {
    const response = await f.remote(path);
    assert.equal(response.status, 401);
    assert.equal(response.text.includes('calibration-demo'), false);
    assert.equal(response.text.includes(f.agentHome), false);
  }
  const Cookie = await f.authenticate();
  const result = await f.remote(f.query({ kind: 'refinement', q: 'validation' }), { headers: { Cookie } });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.total, 1);
  const detail = await f.remote(f.item(result.json.items[0].id), { headers: { Cookie } });
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.changes[0].before.content, 'Vérifier le filtre avant distribution.');
  assert.match(detail.json.changes[0].after.content, /48 kHz/);
  assert.equal(detail.json.source.messageId, 'refinement-entry');
  assert.equal(detail.json.source.sessionId, 'calibration-demo');
  assert.equal(detail.json.source.line, 5);
  assert.match(detail.headers['cache-control'], /no-store/);
  const child = await f.remote(f.query({ q: 'convolution', kind: 'history' }), { headers: { Cookie } });
  assert.equal(child.status, 200);
  assert.ok(child.json.items.some((record) => record.sessionId === 'child-closed'));
  const memories = await f.remote(f.query({ kind: 'memory' }), { headers: { Cookie } });
  assert.equal(memories.status, 200);
  assert.deepEqual(
    new Set(memories.json.items.map((record) => record.scope)),
    new Set(['session', 'global']),
  );
  assert.deepEqual(await nativeSnapshot(f.agentHome), before);
  assert.equal(f.app.runs.size, 0);
});

test('knowledge HTTP validates query, project, id, limit and cursor without leaking another project', async (t) => {
  const f = await fixture(t),
    Cookie = await f.authenticate();
  const foreign = await f.local(f.query({ cwd: f.otherCwd, q: 'PROJECT_BOUNDARY_SENTINEL' }));
  assert.equal(foreign.status, 200, foreign.text);
  assert.equal(foreign.json.total, 1);
  const hidden = await f.remote(f.query({ q: 'PROJECT_BOUNDARY_SENTINEL' }), { headers: { Cookie } });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.json.total, 0);
  const crossProject = await f.remote(f.item(foreign.json.items[0].id), { headers: { Cookie } });
  assert.equal(crossProject.status, 404);
  assert.equal(crossProject.text.includes('PROJECT_BOUNDARY_SENTINEL'), false);
  for (const [path, status] of [
    ['/api/knowledge', 400],
    [f.query({ cwd: '../relative' }), 400],
    [f.query({ cwd: f.root }), 404],
    [f.query({ q: 'x'.repeat(501) }), 400],
    [f.query({ kind: 'arbitrary-file' }), 400],
    ...['0', '101', '-1', '1.5', 'NaN'].map((limit) => [f.query({ limit }), 400]),
    [f.query({ cursor: '../../private' }), 400],
    [f.item('../../native/auth.json'), 400],
    [f.item('f'.repeat(64)), 404],
  ]) {
    const response = await f.remote(path, { headers: { Cookie } });
    assert.equal(response.status, status, `${path}: ${response.text}`);
    assert.equal(response.json?.error?.startsWith('knowledge.'), false, response.text);
  }
  const first = await f.local(f.query({ limit: 1 }));
  assert.ok(first.json.nextCursor);
  const next = await f.remote(f.query({ limit: 1, cursor: first.json.nextCursor }), { headers: { Cookie } });
  assert.equal(next.status, 200);
  assert.notEqual(next.json.items[0].id, first.json.items[0].id);
  assert.equal(
    (await f.remote(f.query({ q: 'changed', cursor: first.json.nextCursor }), { headers: { Cookie } }))
      .status,
    400,
  );
});

test('knowledge offers no write routes locally or through LAN and rejects cross-origin access', async (t) => {
  const f = await fixture(t),
    Cookie = await f.authenticate();
  const before = await nativeSnapshot(f.agentHome);
  const projects = JSON.parse(await readFile(join(f.dataDir, 'workspace.json'), 'utf8')).projects;
  for (const method of ['POST', 'PATCH', 'DELETE'])
    for (const path of [f.query(), f.item('b'.repeat(64))]) {
      const options = {
        method,
        headers: { Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'mutated' }),
      };
      assert.equal((await f.remote(path, options)).status, 405);
      assert.equal((await f.local(path, options)).status, 404);
    }
  assert.equal(
    (await f.remote(f.query(), { headers: { Cookie, Origin: 'https://unrelated.invalid' } })).status,
    403,
  );
  assert.equal((await f.local(f.query(), { headers: { Origin: 'https://unrelated.invalid' } })).status, 403);
  const mutations = await f.remote('/api/projects/move', {
    method: 'POST',
    headers: { Cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: f.cwd, direction: 1 }),
  });
  assert.equal(mutations.status, 405);
  assert.deepEqual(await nativeSnapshot(f.agentHome), before);
  assert.deepEqual(JSON.parse(await readFile(join(f.dataDir, 'workspace.json'), 'utf8')).projects, projects);
  assert.equal(f.app.runs.size, 0);
});
