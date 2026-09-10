import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createRoadmapSessionResolver } from '../lib/roadmap-session.mjs';

test('cold Roadmap references navigate exact parents and deep children without a runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'roadmap-cold-'));
  const cwd = join(directory, 'project'),
    other = join(directory, 'other'),
    agentHome = join(directory, 'agent'),
    sessionDir = join(agentHome, 'sessions'),
    childDir = join(agentHome, 'session-artifacts', 'parent');
  await Promise.all([cwd, other, sessionDir, childDir].map((path) => mkdir(path, { recursive: true })));
  const files = {
    parent: join(sessionDir, 'parent.jsonl'),
    stranger: join(sessionDir, 'stranger.jsonl'),
    child: join(childDir, 'child.jsonl'),
    grandchild: join(childDir, 'grandchild.jsonl'),
  };
  for (const [id, file] of Object.entries(files))
    await writeFile(
      file,
      `${JSON.stringify({ type: 'session', version: 3, id, cwd: id === 'stranger' ? other : cwd, timestamp: '2026-09-09T01:00:00.000Z' })}\n`,
    );
  const store = createStore({ sessionDir, dataDir: join(directory, 'data') });
  await store.project({ cwd });
  await store.project({ cwd: other });
  const edges = [
    { childId: 'worker-child', child: files.child, parent: files.parent, name: 'Child' },
    { childId: 'worker-grandchild', child: files.grandchild, parent: files.child, name: 'Grandchild' },
  ];
  const resolve = createRoadmapSessionResolver({
    store,
    agentHome,
    sessionDir,
    readEdges: async () => edges,
  });
  const before = await readFile(files.grandchild, 'utf8');
  assert.deepEqual(await resolve({ cwd, sessionId: 'parent' }), {
    sessionId: 'parent',
    rootSessionId: 'parent',
  });
  assert.deepEqual(await resolve({ cwd, sessionId: 'child' }), {
    sessionId: 'child',
    rootSessionId: 'parent',
    agentId: 'worker-child',
  });
  assert.deepEqual(await resolve({ cwd, sessionId: 'grandchild', rootSessionId: 'parent' }), {
    sessionId: 'grandchild',
    rootSessionId: 'parent',
    agentId: 'worker-grandchild',
  });
  await assert.rejects(resolve({ cwd, sessionId: 'stranger' }), { status: 404 });
  await assert.rejects(resolve({ cwd: other, sessionId: 'child' }), { status: 404 });
  await assert.rejects(resolve({ cwd, sessionId: 'child', rootSessionId: 'stranger' }), { status: 404 });
  await assert.rejects(resolve({ cwd, sessionId: '../child' }), { status: 400 });
  assert.equal(await readFile(files.grandchild, 'utf8'), before);
  edges[0].deleted = 'user';
  await assert.rejects(resolve({ cwd, sessionId: 'grandchild' }), { status: 404 });
});
