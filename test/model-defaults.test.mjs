import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelDefaultsStore } from '../lib/model-defaults.mjs';

async function fixture(t, settings) {
  const agentHome = await mkdtemp(join(tmpdir(), 'prime-studio-model-defaults-'));
  if (settings !== undefined) await writeFile(join(agentHome, 'settings.json'), settings, 'utf8');
  t.after(() => rm(agentHome, { recursive: true, force: true }));
  return { agentHome, store: createModelDefaultsStore({ agentHome }) };
}

test('writes the native Prime Agent main-model fields and recent model list', async (t) => {
  const { agentHome, store } = await fixture(t);
  assert.deepEqual(await store.get(), {
    mainModel: '',
    subagents: { mode: 'inherit', configurable: false },
  });
  const result = await store.set({ provider: 'opencode', id: 'muse-spark-1.3-contributor-free' });
  assert.equal(result.mainModel, 'opencode/muse-spark-1.3-contributor-free');
  assert.deepEqual(result.subagents, { mode: 'inherit', configurable: false });
  const saved = JSON.parse(await readFile(join(agentHome, 'settings.json'), 'utf8'));
  assert.equal(saved.defaultProvider, 'opencode');
  assert.equal(saved.defaultModel, 'muse-spark-1.3-contributor-free');
  assert.deepEqual(saved.recentModels, ['opencode/muse-spark-1.3-contributor-free']);
});

test('preserves unrelated settings and never returns their values', async (t) => {
  const initial = JSON.stringify(
    {
      theme: 'dark',
      defaultProvider: 'old-provider',
      defaultModel: 'old-model',
      recentModels: ['old-provider/old-model', 'other/model'],
      mcpServers: { private: { type: 'http', url: 'https://private.test', bearerTokenEnvVar: 'SECRET_ENV' } },
    },
    null,
    2,
  );
  const { agentHome, store } = await fixture(t, initial);
  const result = await store.set({ provider: 'fixture', id: 'new-model' });
  assert.deepEqual(result, {
    mainModel: 'fixture/new-model',
    subagents: { mode: 'inherit', configurable: false },
  });
  assert.doesNotMatch(JSON.stringify(result), /private|SECRET_ENV/);
  const saved = JSON.parse(await readFile(join(agentHome, 'settings.json'), 'utf8'));
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.mcpServers.private.bearerTokenEnvVar, 'SECRET_ENV');
  assert.deepEqual(saved.recentModels, ['fixture/new-model', 'old-provider/old-model', 'other/model']);
  assert.equal(await readFile(join(agentHome, 'settings.json.prime-studio.bak'), 'utf8'), initial);

  await store.set(null);
  const cleared = JSON.parse(await readFile(join(agentHome, 'settings.json'), 'utf8'));
  assert.equal('defaultProvider' in cleared, false);
  assert.equal('defaultModel' in cleared, false);
  assert.equal(cleared.theme, 'dark');
});

test('rejects invalid selections and refuses to overwrite broken settings', async (t) => {
  const { store } = await fixture(t);
  for (const selection of [
    { provider: '__proto__', id: 'model' },
    { provider: 'Provider', id: 'model' },
    { provider: 'provider', id: 'two words' },
    { provider: 'provider', id: 'model', extra: true },
  ])
    await assert.rejects(store.set(selection), (error) => error.status === 400);

  const broken = '{ "defaultProvider": ';
  const separate = await fixture(t, broken);
  await assert.rejects(separate.store.set({ provider: 'fixture', id: 'model' }), /JSON invalide/);
  assert.equal(await readFile(join(separate.agentHome, 'settings.json'), 'utf8'), broken);
});
