import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, appendFile, rm, unlink, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createKnowledge } from '../lib/knowledge.mjs';

const when = '2026-09-09T12:00:00.000Z';
const message = (id, parentId, text, role = 'assistant') => ({
  type: 'message',
  id,
  parentId,
  timestamp: when,
  message: { role, content: [{ type: 'text', text }] },
});
const memory = (id, content, scope = 'local') => ({
  id,
  kind: 'memory',
  title: `Mémoire ${id}`,
  content,
  scope,
  path: 'general',
  reference: {},
  arguments: {},
  metadata: {},
  source: 'refine',
  created_at: when,
  updated_at: when,
  version: 1,
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'prime-knowledge-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const options = {
    agentHome: join(root, 'agent'),
    sessionDir: join(root, 'agent', 'sessions'),
    dataDir: join(root, 'studio'),
    initialCwd: join(root, 'Projet é'),
  };
  const other = join(root, 'Autre projet');
  await Promise.all([
    mkdir(options.sessionDir, { recursive: true }),
    mkdir(options.initialCwd),
    mkdir(other),
  ]);
  const store = createStore(options);
  await store.project({ cwd: options.initialCwd });
  await store.project({ cwd: other });
  const api = () => createKnowledge({ ...options, store });
  const knowledge = api();
  async function native(id, entries, cwd = options.initialCwd, dir = options.sessionDir) {
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${id}.jsonl`);
    await writeFile(
      file,
      [{ type: 'session', id, cwd, timestamp: when }, ...entries].map(JSON.stringify).join('\n') + '\n',
    );
    return file;
  }
  async function harness(
    memories,
    scope = 'session',
    id = 'main-session',
    file = join(options.sessionDir, `${id}.jsonl`),
  ) {
    const path =
      scope === 'global'
        ? join(options.agentHome, 'harness', 'harness_state.json')
        : join(dirname(dirname(file)), 'session-artifacts', id, 'harness', 'harness_state.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        schema: 1,
        entries: { memory: memories, prompt: {}, skill: {}, subagent: {} },
        refinements: [],
      }),
    );
    return path;
  }
  return { root, options, cwd: options.initialCwd, other, store, knowledge, api, native, harness };
}

test('project search finds native memories and closed children with exact sources and excludes other projects', async (t) => {
  const f = await fixture(t);
  const main = await f.native('main-session', [
    message('u1', null, 'Préparer la calibration', 'user'),
    message('a1', 'u1', 'Mesure de référence validée'),
  ]);
  const childDir = join(f.options.agentHome, 'session-artifacts', 'main-session', 'sub-closed');
  const child = await f.native(
    'child-session',
    [message('c1', null, 'Conclusion : correction acoustique validée')],
    f.cwd,
    childDir,
  );
  await f.native('foreign-session', [message('secret1', null, 'secret extérieur calibration')], f.other);
  await f.native(
    'foreign-child',
    [message('secret2', null, 'secret extérieur enfant')],
    f.other,
    join(f.options.agentHome, 'session-artifacts', 'main-session', 'sub-foreign'),
  );
  const localMemory = await f.harness({ m1: memory('m1', 'Conserver la fréquence de référence') });
  await f.harness({ m1: memory('m1', 'Préférence globale : sobre', 'global') }, 'global');
  const before = await Promise.all([main, child, localMemory].map((file) => readFile(file, 'utf8')));
  const results = await f.knowledge.search({ cwd: f.cwd, q: 'de reference' });
  assert.equal(results.total, 2);
  assert.deepEqual(results.counts, { history: 1, memory: 1, refinement: 0 });
  const source = results.items.find((item) => item.kind === 'history').source;
  assert.deepEqual(source, { path: main, line: 3, sessionId: 'main-session', messageId: 'a1' });
  const children = await f.knowledge.search({ cwd: f.cwd, q: 'acoustique' });
  assert.equal(children.items[0].sessionId, 'child-session');
  assert.equal(children.items[0].sessionOpenable, false);
  assert.equal(children.items[0].source.path, child);
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'secret' })).total, 0);
  await assert.rejects(f.knowledge.detail({ cwd: f.other, id: children.items[0].id }), { status: 404 });
  const memories = await f.knowledge.search({ cwd: f.cwd, kind: 'memory' });
  assert.equal(memories.items.length, 2);
  assert.deepEqual(new Set(memories.items.map((item) => item.scope)), new Set(['global', 'session']));
  assert.equal(memories.items.find((item) => item.scope === 'session').source.pointer, '/entries/memory/m1');
  assert.deepEqual(
    await Promise.all([main, child, localMemory].map((file) => readFile(file, 'utf8'))),
    before,
  );
});

test('selected native branch excludes abandoned answers; refinement history retains real before/after', async (t) => {
  const f = await fixture(t),
    before = memory('m1', 'ancienne valeur'),
    after = { ...memory('m1', 'valeur corrigée'), version: 2 };
  await f.native('main-session', [
    message('u1', null, 'Question', 'user'),
    message('abandoned', 'u1', 'Conclusion abandonnée'),
    {
      type: 'custom',
      id: 'ref-entry',
      parentId: 'abandoned',
      timestamp: when,
      customType: 'prime-agent.refinement',
      data: {
        id: 'refine_native',
        scope: 'local',
        summary: 'Correction de la mémoire',
        rationale: 'Mesure exacte',
        expectedOutcome: 'Éviter une répétition',
        appliedEdits: [{ action: 'update', kind: 'memory', id: 'm1', applied: true, before, after }],
        harnessStatePath: 'Z:/must-not-be-read.json',
      },
    },
    message('active', 'u1', 'Conclusion retenue'),
  ]);
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'abandonnée' })).total, 0);
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'retenue' })).total, 1);
  const refinements = await f.knowledge.search({ cwd: f.cwd, kind: 'refinement', q: 'corrigee' });
  assert.equal(refinements.total, 1);
  const detail = await f.knowledge.detail({ cwd: f.cwd, id: refinements.items[0].id });
  assert.equal(detail.changes[0].before.content, before.content);
  assert.equal(detail.changes[0].after.content, after.content);
  assert.equal(detail.source.line, 4);
  assert.equal(detail.date, when);
  assert.equal(JSON.stringify(detail).includes('must-not-be-read'), false);
});

test('JSONL append reads only new bytes, survives a fresh worker, branch changes and source removal', async (t) => {
  const f = await fixture(t);
  const file = await f.native('main-session', [
    message('first', null, 'Original'),
    {
      type: 'message',
      id: 'tool',
      parentId: 'first',
      message: { role: 'toolResult', content: 'x'.repeat(1024 * 1024) },
    },
  ]);
  await f.knowledge.search({ cwd: f.cwd });
  const first = f.knowledge.diagnostics();
  await f.knowledge.search({ cwd: f.cwd });
  assert.equal(f.knowledge.diagnostics().bytesRead, first.bytesRead);
  await appendFile(file, JSON.stringify(message('second', 'tool', 'Ajout incrémental')) + '\n');
  const appended = await f.knowledge.search({ cwd: f.cwd, q: 'incremental' });
  assert.equal(appended.total, 1);
  assert.equal(f.knowledge.diagnostics().appendReads, 1);
  assert.ok(f.knowledge.diagnostics().bytesRead - first.bytesRead < 10_000);
  const worker = f.api();
  assert.equal((await worker.search({ cwd: f.cwd, q: 'incremental' })).total, 1);
  assert.equal(worker.diagnostics().diskHits, 1);
  assert.equal(worker.diagnostics().fullReads, 0);
  await f.native('main-session', [message('replacement', null, 'Historique remplacé')]);
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'incremental' })).total, 0);
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'remplace' })).total, 1);
  await unlink(file);
  await assert.rejects(f.knowledge.detail({ cwd: f.cwd, id: appended.items[0].id }), { status: 404 });
});

test('global refinements deduplicate native session copies and memory replacement invalidates the index', async (t) => {
  const f = await fixture(t),
    before = memory('global-note', 'Old global', 'global'),
    after = memory('global-note', 'New global', 'global');
  const data = {
    id: 'refine_global',
    summary: 'Global correction',
    scope: 'global',
    appliedEdits: [{ id: 'global-note', kind: 'memory', action: 'update', applied: true, before, after }],
  };
  await f.native('main-session', [
    {
      type: 'custom',
      id: 'ref',
      parentId: null,
      timestamp: when,
      customType: 'prime-agent.refinement',
      data,
    },
  ]);
  const memoryFile = await f.harness({ 'global-note': after }, 'global');
  await writeFile(join(dirname(memoryFile), 'refinements.jsonl'), JSON.stringify(data) + '\n');
  const result = await f.knowledge.search({ cwd: f.cwd, kind: 'refinement' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].scope, 'global');
  assert.equal(result.items[0].sessionId, 'main-session');
  await f.harness({}, 'global');
  assert.equal((await f.knowledge.search({ cwd: f.cwd, kind: 'memory' })).total, 0);
});

test('rejects invalid inputs, query cursor reuse, removed projects and symlink escapes', async (t) => {
  const f = await fixture(t);
  await f.native('main-session', [message('one', null, 'One'), message('two', 'one', 'Two')]);
  await assert.rejects(f.knowledge.search({ cwd: '../relative' }), { status: 400 });
  await assert.rejects(f.knowledge.search({ cwd: f.cwd, q: 'x'.repeat(501) }), { status: 400 });
  await assert.rejects(f.knowledge.search({ cwd: f.cwd, limit: 101 }), { status: 400 });
  await assert.rejects(f.knowledge.detail({ cwd: f.cwd, id: '../../etc/passwd' }), { status: 400 });
  const first = await f.knowledge.search({ cwd: f.cwd, limit: 1 });
  assert.ok(first.nextCursor);
  const second = await f.knowledge.search({ cwd: f.cwd, limit: 1, cursor: first.nextCursor });
  assert.notEqual(first.items[0].id, second.items[0].id);
  await assert.rejects(f.knowledge.search({ cwd: f.cwd, q: 'changed', cursor: first.nextCursor }), {
    status: 400,
  });
  const outside = join(f.root, 'outside');
  await f.native('escape-session', [message('escape', null, 'Leaked data')], f.cwd, outside);
  await symlink(
    outside,
    join(f.options.sessionDir, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'Leaked' })).total, 0);
  await f.store.removeProject(f.cwd);
  await assert.rejects(f.knowledge.search({ cwd: f.cwd }), { status: 404 });
});

test('coalesces concurrent refresh and excludes tool echoes from knowledge results', async (t) => {
  const f = await fixture(t);
  await f.native('main-session', [
    message('text', null, 'Actual response'),
    {
      type: 'message',
      id: 'echo',
      parentId: 'text',
      message: {
        role: 'toolResult',
        content: 'Replayed retrieval secret',
        toolName: 'studio_knowledge_search',
      },
    },
  ]);
  const results = await Promise.all(Array.from({ length: 6 }, () => f.knowledge.search({ cwd: f.cwd })));
  assert.equal(f.knowledge.diagnostics().fullReads, 1);
  assert.ok(results.every((result) => result.total === 1));
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'Replayed' })).total, 0);
});

test('unfinished JSONL appends become visible only when complete and nested child memory stays associated', async (t) => {
  const f = await fixture(t);
  const file = await f.native('main-session', [message('first', null, 'Initial')]);
  await f.knowledge.search({ cwd: f.cwd });
  const append = JSON.stringify(message('second', 'first', 'Append complété'));
  await appendFile(file, append.slice(0, 30));
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'complete' })).total, 0);
  await appendFile(file, append.slice(30) + '\n');
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'complete' })).total, 1);
  const child = await f.native(
    'child-one',
    [message('child-msg', null, 'Child')],
    f.cwd,
    join(f.options.agentHome, 'session-artifacts', 'main-session', 'sub-one'),
  );
  const grandchild = await f.native(
    'child-two',
    [message('grandchild-msg', null, 'Nested result')],
    f.cwd,
    join(dirname(dirname(child)), 'session-artifacts', 'child-one', 'sub-two'),
  );
  await f.harness(
    { nested: memory('nested', 'Mémoire de la délégation profonde') },
    'session',
    'child-two',
    grandchild,
  );
  const found = await f.knowledge.search({ cwd: f.cwd, q: 'delegation profonde' });
  assert.equal(found.total, 1);
  assert.equal(found.items[0].sessionId, 'child-two');
  assert.equal(found.items[0].sessionOpenable, false);
});

test('unsafe derived cache junction never writes native files and still allows read-only search', async (t) => {
  const f = await fixture(t);
  await f.native('main-session', [message('answer', null, 'Read-only search')]);
  await symlink(
    f.options.agentHome,
    join(f.options.dataDir, 'knowledge-index'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = await f.knowledge.search({ cwd: f.cwd });
  assert.equal(result.total, 1);
  assert.ok(result.warnings.includes('cache_unavailable'));
  assert.equal(await stat(join(f.options.agentHome, 'v1')).catch(() => null), null);
});

test('untrusted harness paths cannot escape roots and oversized records explicitly report truncation', async (t) => {
  const f = await fixture(t);
  await f.native('main-session', [message('large', null, 'Long text '.repeat(10_000))]);
  const outside = join(f.root, 'foreign-harness');
  await mkdir(outside);
  await writeFile(
    join(outside, 'harness_state.json'),
    JSON.stringify({ entries: { memory: { escaped: memory('escaped', 'leaked harness') } } }),
  );
  await symlink(
    outside,
    join(f.options.agentHome, 'harness'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.equal((await f.knowledge.search({ cwd: f.cwd, q: 'leaked' })).total, 0);
  const result = await f.knowledge.search({ cwd: f.cwd, q: 'Long text' });
  assert.ok(result.items[0].truncated);
  assert.ok(result.items[0].excerpt.length <= 362);
  const detail = await f.knowledge.detail({ cwd: f.cwd, id: result.items[0].id });
  assert.equal(detail.body.length, 64_000);
  assert.ok(detail.truncated);
});

test('fresh workers load only the requested project cache and refresh changed native header membership', async (t) => {
  const f = await fixture(t);
  const projects = [f.cwd, f.other];
  for (let index = 2; index < 5; index++) {
    const cwd = join(f.root, `Project ${index}`);
    await mkdir(cwd);
    await f.store.project({ cwd });
    projects.push(cwd);
  }
  const files = [];
  for (let project = 0; project < projects.length; project++) {
    files.push(
      await f.native(
        `project-${project}`,
        Array.from({ length: 25 }, (_, index) =>
          message(
            `p${project}-${index}`,
            index ? `p${project}-${index - 1}` : null,
            `PROJECT_${project}_EVIDENCE ${'Native conversation content. '.repeat(400)}`,
          ),
        ),
        projects[project],
      ),
    );
  }
  // Populate every project cache, then simulate a new one-shot agent worker.
  for (const cwd of projects) await f.knowledge.search({ cwd });
  const worker = f.api();
  const requested = await worker.search({ cwd: f.cwd, q: 'PROJECT_0_EVIDENCE' });
  assert.equal(requested.total, 25);
  assert.equal(worker.diagnostics().diskHits, 1, 'unrelated full conversation indexes must not be loaded');
  assert.equal(worker.diagnostics().fullReads, 0);
  assert.ok(
    worker.diagnostics().bytesRead <= 4096 * projects.length,
    'membership reads are bounded native headers',
  );
  const warmed = worker.diagnostics();
  await worker.search({ cwd: f.cwd });
  assert.equal(worker.diagnostics().bytesRead, warmed.bytesRead, 'unchanged native headers are memoized');
  await appendFile(
    files[0],
    JSON.stringify(message('new-evidence', 'p0-24', 'Newly appended evidence')) + '\n',
  );
  assert.equal((await worker.search({ cwd: f.cwd, q: 'Newly appended' })).total, 1);
  assert.equal(worker.diagnostics().appendReads, 1);
  // A rewrite that changes native cwd must invalidate the memoized membership.
  await f.native('project-1', [message('moved', null, 'Newly associated project evidence')], f.cwd);
  assert.equal((await worker.search({ cwd: f.cwd, q: 'associated' })).total, 1);
  assert.equal(worker.diagnostics().diskHits, 2);
  assert.equal((await worker.search({ cwd: f.other, q: 'associated' })).total, 0);
});
