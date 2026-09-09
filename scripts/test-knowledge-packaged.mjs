// Invoke the copied desktop extension from an unrelated directory using its
// bundled Node. This catches imports that accidentally depend on the checkout.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, appendFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const studio = resolve(process.argv[2] || '.desktop-build/studio');
const load = (file) => import(pathToFileURL(join(studio, file)));
const { createStore } = await load('lib/store.mjs');
const { discoverCli } = await load('lib/agent.mjs');
const { verifyDesktopRuntimeResources } = await load('scripts/desktop-runtime-resources.mjs');
await verifyDesktopRuntimeResources(studio);
const cli = discoverCli();
assert.ok(cli?.packageDir, 'Install Prime Agent for native extension loading');
const { loadExtensions } = await import(
  pathToFileURL(join(cli.packageDir, 'dist/core/extensions/loader.js'))
);
const root = await mkdtemp(join(tmpdir(), 'studio-packaged-knowledge-'));
const cwd = join(root, 'External project'),
  other = join(root, 'Another project');
const config = {
  dataDir: join(root, 'studio'),
  agentHome: join(root, 'agent'),
  sessionDir: join(root, 'agent/sessions'),
};
await Promise.all([cwd, other, config.sessionDir].map((path) => mkdir(path, { recursive: true })));
const store = createStore(config);
await store.project({ cwd });
await store.project({ cwd: other });
const history = join(config.sessionDir, 'prior.jsonl');
const header = { type: 'session', id: 'prior', cwd, timestamp: '2026-09-04T00:00:00.000Z' };
const entry = (id, parentId, text) => ({
  type: 'message',
  id,
  parentId,
  timestamp: '2026-09-04T00:01:00.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
});
const original =
  [
    header,
    ...Array.from({ length: 150 }, (_, i) =>
      entry(
        `answer-${i}`,
        i ? `answer-${i - 1}` : null,
        `PACKAGED_EVIDENCE_${i} ` + 'Original bounded evidence. '.repeat(200),
      ),
    ),
  ]
    .map((record) => JSON.stringify(record))
    .join('\n') + '\n';
await writeFile(history, original);
const previousDirectory = process.cwd(),
  previousConfig = process.env.PRIME_STUDIO_KNOWLEDGE_CONFIG;
try {
  process.chdir(cwd);
  process.env.PRIME_STUDIO_KNOWLEDGE_CONFIG = JSON.stringify(config);
  const loaded = await loadExtensions([join(studio, 'runtime/studio-knowledge-extension.mjs')], cwd);
  assert.deepEqual(loaded.errors, []);
  const tools = loaded.extensions[0].tools;
  const execute = async (name, params, project = cwd) =>
    JSON.parse(
      (await tools.get(name).definition.execute('packaged', params, undefined, undefined, { cwd: project }))
        .content[0].text,
    );
  // Parallel workers have independent backends, sharing only disposable diskcache.
  const results = await Promise.all(
    Array.from({ length: 6 }, () => execute('studio_knowledge_search', { q: 'PACKAGED_EVIDENCE_149' })),
  );
  for (const result of results) assert.equal(result.items.length, 1);
  assert.equal(new Set(results.map((result) => result.items[0].id)).size, 1);
  const id = results[0].items[0].id;
  const detail = await execute('studio_knowledge_read', { id });
  assert.match(detail.body, /PACKAGED_EVIDENCE_149/);
  assert.equal(detail.source.path, history);
  await assert.rejects(execute('studio_knowledge_read', { id }, other));
  assert.equal(await readFile(history, 'utf8'), original);
  const append = JSON.stringify(entry('last-answer', 'answer-149', 'APPENDED_PACKAGED_EVIDENCE')) + '\n';
  await appendFile(history, append);
  const refreshed = await Promise.all(
    Array.from({ length: 6 }, () => execute('studio_knowledge_search', { q: 'APPENDED_PACKAGED_EVIDENCE' })),
  );
  for (const result of refreshed) assert.equal(result.items.length, 1);
  const files = await readdir(join(config.dataDir, 'knowledge-index/v1'));
  assert.ok(files.length);
  assert.ok(
    files.every((file) => file.endsWith('.json')),
    'No partial cache publication remains',
  );
  for (const file of files)
    JSON.parse(await readFile(join(config.dataDir, 'knowledge-index/v1', file), 'utf8'));
  assert.equal(await readFile(history, 'utf8'), original + append);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Copied desktop dependency closure',
          'Native extension executes copied worker outside checkout',
          'Six simultaneous cross-process cache readers',
          'Fresh append discovered by six simultaneous workers',
          'Project scope and native source preservation',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  process.chdir(previousDirectory);
  if (previousConfig === undefined) delete process.env.PRIME_STUDIO_KNOWLEDGE_CONFIG;
  else process.env.PRIME_STUDIO_KNOWLEDGE_CONFIG = previousConfig;
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
}
