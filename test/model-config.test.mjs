import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelConfigStore } from '../lib/model-config.mjs';

async function fixture(t, { models, auth, env = {} } = {}) {
  const agentHome = await mkdtemp(join(tmpdir(), 'prime-studio-model-config-'));
  if (models !== undefined) await writeFile(join(agentHome, 'models.json'), models, 'utf8');
  if (auth !== undefined) await writeFile(join(agentHome, 'auth.json'), JSON.stringify(auth), 'utf8');
  t.after(() => rm(agentHome, { recursive: true, force: true }));
  return { agentHome, store: createModelConfigStore({ agentHome, env }) };
}

const definition = (overrides = {}) => ({
  provider: 'fixture',
  providerName: 'Fixture',
  id: 'model-one',
  name: 'Model One',
  api: 'openai-responses',
  baseUrl: 'https://models.example.test/v1',
  credentialEnv: 'FIXTURE_API_KEY',
  reasoning: true,
  input: ['text', 'image'],
  contextWindow: 128000,
  maxTokens: 16384,
  ...overrides,
});

test('edits and removes models while preserving private and advanced provider data', async (t) => {
  const original = `{
    // This comment is accepted by Prime Agent.
    "providers": {
      "fixture": {
        "name": "Private fixture",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "api": "openai-completions",
        "apiKey": "fixture-literal-secret",
        "headers": { "X-Private": "fixture-header-secret" },
        "models": [{
          "id": "model-one",
          "name": "Old name",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 32000,
          "maxTokens": 4096,
          "compat": { "supportsDeveloperRole": false },
        }],
      },
    },
  }`;
  const { agentHome, store } = await fixture(t, { models: original });
  const listed = await store.list();
  assert.equal(listed.models[0].advanced, true);
  assert.doesNotMatch(JSON.stringify(listed), /fixture-literal-secret|fixture-header-secret/);

  await store.upsert(
    definition({
      original: { provider: 'fixture', id: 'model-one' },
      name: 'Updated model',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:11434/v1',
      credentialEnv: '',
      reasoning: false,
      input: ['text'],
      contextWindow: 64000,
      maxTokens: 8192,
    }),
  );
  let onDisk = JSON.parse(await readFile(join(agentHome, 'models.json'), 'utf8'));
  assert.equal(onDisk.providers.fixture.apiKey, 'fixture-literal-secret');
  assert.equal(onDisk.providers.fixture.headers['X-Private'], 'fixture-header-secret');
  assert.deepEqual(onDisk.providers.fixture.models[0].compat, { supportsDeveloperRole: false });
  assert.equal(onDisk.providers.fixture.models[0].name, 'Updated model');
  assert.equal(await readFile(join(agentHome, 'models.json.prime-studio.bak'), 'utf8'), original);

  await store.remove({ provider: 'fixture', id: 'model-one' });
  onDisk = JSON.parse(await readFile(join(agentHome, 'models.json'), 'utf8'));
  assert.deepEqual(onDisk.providers.fixture.models, []);
  assert.equal(onDisk.providers.fixture.apiKey, 'fixture-literal-secret');
});

test('serializes concurrent additions so no model is lost', async (t) => {
  const { store } = await fixture(t);
  await Promise.all([
    store.upsert(definition()),
    store.upsert(
      definition({
        provider: 'second',
        providerName: 'Second',
        id: 'model-two',
        name: 'Model Two',
        baseUrl: 'http://localhost:8080/v1',
        credentialEnv: 'SECOND_API_KEY',
      }),
    ),
  ]);
  const listed = await store.list();
  assert.deepEqual(listed.models.map((model) => `${model.provider}/${model.id}`).sort(), [
    'fixture/model-one',
    'second/model-two',
  ]);
});

test('rejects unsafe definitions and never overwrites invalid JSON', async (t) => {
  const { store } = await fixture(t);
  const invalid = [
    definition({ provider: '__proto__' }),
    definition({ api: 'unknown-api' }),
    definition({ baseUrl: 'https://user:secret@example.test/v1' }),
    definition({ baseUrl: 'https://example.test/v1?api_key=secret' }),
    definition({ baseUrl: 'http://192.168.1.20:8080/v1' }),
    definition({ contextWindow: 100, maxTokens: 101 }),
    definition({ credentialEnv: 'not an env name' }),
    definition({ apiKey: '!echo should-never-run' }),
    definition({ provider: 'opencode', credentialEnv: 'OPENCODE_API_KEY' }),
  ];
  for (const value of invalid) await assert.rejects(store.upsert(value), (error) => error.status === 400);
  await store.upsert(definition());
  await assert.rejects(store.upsert(definition()), (error) => error.status === 409);
  await assert.rejects(
    store.upsert(
      definition({
        original: { provider: 'fixture', id: 'model-one' },
        baseUrl: 'https://attacker.example.test/v1',
      }),
    ),
    /protéger ses clés/,
  );

  const broken = '{ "providers": {';
  const separate = await fixture(t, { models: broken });
  await assert.rejects(separate.store.upsert(definition()), /JSON invalide/);
  assert.equal(await readFile(join(separate.agentHome, 'models.json'), 'utf8'), broken);
});
