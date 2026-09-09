import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { discoverCli, agentEnvironment } from '../lib/agent.mjs';
import { createStore } from '../lib/store.mjs';
import { readKnowledgeRequest } from '../scripts/studio-knowledge-worker.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'studio-knowledge-bridge-'));
  const cwd = join(root, 'Project'),
    other = join(root, 'Other');
  const config = {
    agentHome: join(root, 'agent'),
    sessionDir: join(root, 'agent/sessions'),
    dataDir: join(root, 'studio'),
  };
  await Promise.all([cwd, other, config.sessionDir].map((path) => mkdir(path, { recursive: true })));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const store = createStore(config);
  await store.project({ cwd });
  await store.project({ cwd: other });
  const file = join(config.sessionDir, 'history.jsonl');
  const entries = [
    { type: 'session', id: 'history', cwd, timestamp: '2026-09-04T12:00:00.000Z' },
    {
      type: 'message',
      id: 'answer',
      parentId: null,
      timestamp: '2026-09-04T12:01:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'BRIDGE_REFERENCE ' + 'Evidence '.repeat(1800) }],
        stopReason: 'stop',
      },
    },
  ];
  const original = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  await writeFile(file, original);
  return { root, cwd, other, config, file, original };
}

test('knowledge reader bounds excerpts and source detail, enforces project scope, preserves native files', async (t) => {
  const { config, cwd, other, file, original } = await fixture(t);
  const result = await readKnowledgeRequest({
    config,
    cwd,
    action: 'search',
    params: { q: 'BRIDGE_REFERENCE', limit: 100 },
  });
  assert.ok(result.items.length > 0);
  assert.ok(result.items.length <= 8);
  assert.ok(result.items[0].excerpt.length <= 1600);
  const item = await readKnowledgeRequest({
    config,
    cwd,
    action: 'detail',
    params: { id: result.items[0].id },
  });
  assert.match(item.body, /BRIDGE_REFERENCE/);
  assert.equal(item.body.length, 12000);
  assert.equal(item.truncated, true);
  assert.equal(item.source.path, file);
  await assert.rejects(
    readKnowledgeRequest({ config, cwd: other, action: 'detail', params: { id: item.id } }),
  );
  await assert.rejects(readKnowledgeRequest({ config, cwd, action: 'detail', params: { id: file } }));
  await assert.rejects(readKnowledgeRequest({ config, cwd, action: 'search', params: { q: '' } }));
  assert.equal(await readFile(file, 'utf8'), original);
});

test('knowledge bridge settings are never inherited by a Studio launched from an agent', () => {
  const env = agentEnvironment({ env: { PRIME_STUDIO_KNOWLEDGE_CONFIG: '{"dataDir":"other"}' } });
  assert.equal(env.PRIME_STUDIO_KNOWLEDGE_CONFIG, undefined);
});

test('model-visible refinement truncation is explicit on each snapshot and the whole result', async (t) => {
  const { config, cwd, file } = await fixture(t);
  await appendFile(
    file,
    JSON.stringify({
      type: 'custom',
      id: 'refinement',
      parentId: 'answer',
      customType: 'prime-agent.refinement',
      data: {
        id: 'refine-long',
        summary: 'REFINEMENT_BOUNDARY',
        appliedEdits: [
          {
            id: 'long',
            action: 'update',
            kind: 'memory',
            applied: true,
            before: { id: 'long', title: 'Before', content: 'b'.repeat(2000) },
            after: { id: 'long', title: 'After', content: 'Complete short evidence.' },
          },
        ],
      },
    }) + '\n',
  );
  const search = await readKnowledgeRequest({
    config,
    cwd,
    action: 'search',
    params: { q: 'REFINEMENT_BOUNDARY', kind: 'refinement' },
  });
  const result = await readKnowledgeRequest({
    config,
    cwd,
    action: 'detail',
    params: { id: search.items[0].id },
  });
  assert.equal(result.changes[0].before.content.length, 1500);
  assert.equal(result.changes[0].before.truncated, true);
  assert.equal(result.changes[0].after.truncated, false);
  assert.equal(result.truncated, true);
  assert.equal(result.changesTruncated, false, 'All edits are listed, but one snapshot is shortened');
});

test('native extension loader discovers tools; execution uses native cwd and supports cancellation', async (t) => {
  const cli = discoverCli();
  if (!cli?.packageDir) return t.skip('Prime Agent native runtime is not installed');
  const { config, cwd, other } = await fixture(t);
  const { loadExtensions } = await import(
    pathToFileURL(join(cli.packageDir, 'dist/core/extensions/loader.js'))
  );
  const extension = fileURLToPath(new URL('../runtime/studio-knowledge-extension.mjs', import.meta.url));
  const previous = process.env.PRIME_STUDIO_KNOWLEDGE_CONFIG;
  let loaded;
  try {
    process.env.PRIME_STUDIO_KNOWLEDGE_CONFIG = JSON.stringify(config);
    loaded = await loadExtensions([extension], cwd);
  } finally {
    if (previous === undefined) delete process.env.PRIME_STUDIO_KNOWLEDGE_CONFIG;
    else process.env.PRIME_STUDIO_KNOWLEDGE_CONFIG = previous;
  }
  assert.deepEqual(loaded.errors, []);
  const tools = loaded.extensions[0].tools;
  assert.deepEqual([...tools.keys()], ['studio_knowledge_search', 'studio_knowledge_read']);
  const search = tools.get('studio_knowledge_search').definition;
  assert.equal(search.parameters.properties.cwd, undefined, 'Project selection is not model input');
  const response = await search.execute('test', { q: 'BRIDGE_REFERENCE', cwd: other }, undefined, undefined, {
    cwd,
  });
  const result = JSON.parse(response.content[0].text);
  assert.ok(result.items.length);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    search.execute('test', { q: 'BRIDGE_REFERENCE' }, cancelled.signal, undefined, { cwd }),
    /cancelled/,
  );
  const otherResult = await search.execute('test', { q: 'BRIDGE_REFERENCE' }, undefined, undefined, {
    cwd: other,
  });
  assert.equal(JSON.parse(otherResult.content[0].text).items.length, 0);
});
