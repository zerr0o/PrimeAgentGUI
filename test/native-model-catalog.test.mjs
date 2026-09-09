import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createNativeModelCatalog } from '../lib/native-model-catalog.mjs';

const nativeFixture = `
import { readFileSync, appendFileSync } from 'node:fs';
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
export class AuthStorage {
  static create(path, options) {
    if (!options.usePrimeCliConfig) throw new Error('Prime CLI auth source was lost');
    const auth = new AuthStorage();
    auth.path = path;
    auth.reload();
    return auth;
  }
  reload() {
    this.data = json(this.path);
    this.team = json(process.env.CATALOG_FIXTURE_PRIME_CONFIG).team || this.data.team;
  }
  getPrimeCliConfigPath() { return process.env.CATALOG_FIXTURE_PRIME_CONFIG; }
}
export class ModelRegistry {
  static create(auth, path) { return new ModelRegistry(auth, path); }
  constructor(auth, path) {
    this.auth = auth;
    this.path = path;
    this.models = json(path).models || [];
  }
  getAll() { throw new Error('Unfiltered private models must never be read'); }
  getAvailable() {
    if (!this.auth.data.enabled) return [];
    return this.models;
  }
  async refreshAvailableModels() {
    const spec = json(this.path);
    appendFileSync(process.env.CATALOG_FIXTURE_LOG, JSON.stringify({
      pid: process.pid,
      agentHome: process.env.PRIME_AGENT_CODING_AGENT_DIR,
      inheritedWorker: process.env.PRIME_AGENT_INTERNAL_DAEMON_WORKER,
      marker: process.env.CATALOG_FIXTURE_MARKER,
      team: this.auth.team
    }) + '\\n');
    if (spec.fail) throw new Error(spec.fail);
    const liveModels = spec.teams?.[this.auth.team] || spec.liveModels;
    if (liveModels) setTimeout(() => { this.models = liveModels; }, spec.delay || 30);
    return this.getAvailable();
  }
}
`;

async function fixture(t, spec, credentials = { enabled: true, team: 'a' }) {
  const dir = await mkdtemp(join(tmpdir(), 'prime-studio-catalog-'));
  const packageDir = join(dir, 'engine');
  const agentHome = join(dir, 'agent');
  const primeConfig = join(dir, 'prime-cli.json');
  const log = join(dir, 'requests.jsonl');
  const ai = join(packageDir, 'node_modules', '@earendil-works', 'pi-ai', 'dist');
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  await mkdir(agentHome);
  await mkdir(ai, { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(
    join(packageDir, 'node_modules', '@earendil-works', 'pi-ai', 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  await writeFile(join(packageDir, 'dist', 'index.js'), nativeFixture);
  await writeFile(
    join(ai, 'models.js'),
    'export const getSupportedThinkingLevels = (model) => model.reasoning ? ["off", "high", "max", "invalid"] : ["off"];',
  );
  await writeFile(join(agentHome, 'auth.json'), JSON.stringify(credentials));
  await writeFile(join(agentHome, 'settings.json'), '{}');
  await writeFile(join(agentHome, 'models.json'), JSON.stringify(spec));
  await writeFile(primeConfig, '{}');
  const bridge = createNativeModelCatalog({
    cli: { packageDir },
    agentHome,
    env: {
      SystemRoot: process.env.SystemRoot,
      CATALOG_FIXTURE_PRIME_CONFIG: primeConfig,
      CATALOG_FIXTURE_LOG: log,
      CATALOG_FIXTURE_MARKER: 'isolated',
      PRIME_AGENT_INTERNAL_DAEMON_WORKER: 'must-not-be-inherited',
    },
  });
  t.after(async () => {
    await bridge.close();
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('prime-studio-catalog-'));
    await rm(target, { recursive: true, force: true });
  });
  const requests = async () => {
    const content = await readFile(log, 'utf8').catch(() => '');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  return { bridge, agentHome, primeConfig, packageDir, requests };
}

async function until(fn, predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail(`Expected condition did not become true: ${JSON.stringify(value)}`);
}

const model = (id) => ({ id, provider: 'prime-inference', name: id, reasoning: true, input: ['text'] });

test('native bridge sends only safe model fields and owns a persistent isolated worker', async (t) => {
  const secret = 'CATALOG_TEST_SECRET';
  const { bridge, requests, agentHome } = await fixture(t, {
    models: [
      {
        ...model('native/id'),
        input: ['text', 'image', 'secret'],
        contextWindow: 100_000,
        maxTokens: 8192,
        apiKey: secret,
        headers: { authorization: secret },
        baseUrl: `https://host.invalid/${secret}`,
        compat: { value: secret },
      },
    ],
  });
  const reads = await Promise.all(Array.from({ length: 6 }, () => bridge.read()));
  const first = reads[0];
  assert.deepEqual(first.models, [
    {
      id: 'native/id',
      provider: 'prime-inference',
      name: 'native/id',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 100_000,
      maxTokens: 8192,
      thinkingLevels: ['off', 'high', 'max'],
    },
  ]);
  assert.deepEqual(first.configuredProviders, ['prime-inference']);
  assert.equal(JSON.stringify(reads).includes(secret), false);
  const calls = await until(requests, (value) => value.length === 1);
  assert.notEqual(calls[0].pid, process.pid);
  assert.equal(calls[0].agentHome, agentHome);
  assert.equal(calls[0].marker, 'isolated');
  assert.equal(calls[0].inheritedWorker, undefined);
  assert.deepEqual(await bridge.read(), first);
  assert.equal((await requests()).length, 1);
  await bridge.close();
  assert.throws(() => process.kill(calls[0].pid, 0));
  await assert.rejects(bridge.read(), { code: 'NATIVE_MODEL_CATALOG_CLOSED' });
});

test('late native public refresh becomes visible without refetching on every read', async (t) => {
  const { bridge, requests } = await fixture(t, {
    models: [model('bundled')],
    liveModels: [model('live')],
    delay: 150,
  });
  const first = await bridge.read();
  assert.equal(first.models[0].id, 'bundled');
  assert.equal(first.refreshing, true);
  const live = await until(
    () => bridge.read(),
    (value) => value.models[0]?.id === 'live',
  );
  assert.equal(live.refreshing, true);
  assert.equal((await requests()).length, 1);
});

test('OpenRouter provenance distinguishes native public endpoints from per-model custom endpoints without exposing URLs', async (t) => {
  const secret = 'CUSTOM_ENDPOINT_SECRET';
  const official = 'https://openrouter.ai/api/v1';
  const openrouter = (id, baseUrl) => ({ ...model(id), provider: 'openrouter', baseUrl });
  const { bridge } = await fixture(t, {
    models: [
      openrouter('official', official),
      openrouter('official-slash', `${official}/`),
      openrouter('custom-model', `https://custom.invalid/v1?token=${secret}`),
      openrouter('query-override', `${official}?token=${secret}`),
      openrouter('missing-endpoint', undefined),
      { ...model('another-provider'), baseUrl: official },
    ],
  });
  const result = await bridge.read();
  const flags = Object.fromEntries(result.models.map((entry) => [entry.id, entry.openRouterPublic]));
  assert.deepEqual(flags, {
    official: true,
    'official-slash': true,
    'custom-model': false,
    'query-override': false,
    'missing-endpoint': false,
    'another-provider': undefined,
  });
  assert.equal('openRouterPublic' in result.models.find((entry) => entry.id === 'another-provider'), false);
  assert.ok(result.models.every((entry) => !('baseUrl' in entry)));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('https://'), false);
});

test('auth and Prime CLI team changes cannot revive an older in-flight catalogue', async (t) => {
  const { bridge, agentHome, primeConfig, requests } = await fixture(t, {
    models: [model('public')],
    teams: { a: [model('private/a')], b: [model('private/b')] },
    delay: 250,
  });
  await bridge.read();
  await until(requests, (value) => value.length === 1);
  await writeFile(primeConfig, JSON.stringify({ team: 'b' }));
  const changed = await bridge.read();
  assert.deepEqual(
    changed.models.map((m) => m.id),
    ['public'],
  );
  await until(
    () => bridge.read(),
    (value) => value.models[0]?.id === 'private/b',
  );
  await writeFile(join(agentHome, 'auth.json'), JSON.stringify({ enabled: false, team: 'b' }));
  assert.deepEqual((await bridge.read()).models, []);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual((await bridge.read()).models, []);
});

test('model and settings edits invalidate the native catalogue within the refresh TTL', async (t) => {
  const { bridge, agentHome, requests } = await fixture(t, { models: [model('before')] });
  await bridge.read();
  await until(requests, (value) => value.length === 1);
  await writeFile(join(agentHome, 'models.json'), JSON.stringify({ models: [model('after')] }));
  assert.equal((await bridge.read()).models[0].id, 'after');
  await until(requests, (value) => value.length === 2);
  await writeFile(join(agentHome, 'settings.json'), JSON.stringify({ defaultProvider: 'prime-inference' }));
  await bridge.read();
  await until(requests, (value) => value.length === 3);
});

test(
  'observation settles within a bound and explicit refresh bypasses the automatic TTL',
  { timeout: 18_000 },
  async (t) => {
    const { bridge, requests } = await fixture(t, { models: [model('available')] });
    assert.equal((await bridge.read()).refreshing, true);
    await until(
      () => bridge.read(),
      (value) => !value.refreshing,
      14_000,
    );
    assert.equal((await requests()).length, 1);
    assert.equal((await bridge.read({ refresh: true })).refreshing, true);
    await until(requests, (value) => value.length === 2);
  },
);

test('native failures preserve the bundled snapshot without exposing diagnostic secrets', async (t) => {
  const secret = 'CATALOG_REFRESH_SECRET';
  const { bridge } = await fixture(t, { models: [model('fallback')], fail: secret });
  await bridge.read();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const result = await bridge.read();
  assert.equal(result.models[0].id, 'fallback');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('unsupported native engines fail safely and closing rejects pending worker requests', async (t) => {
  const { bridge, packageDir } = await fixture(t, { models: [] });
  await writeFile(join(packageDir, 'dist', 'index.js'), 'throw new Error("IMPORT_SECRET");');
  await assert.rejects(
    bridge.read(),
    (error) => error.code === 'NATIVE_MODEL_CATALOG_UNAVAILABLE' && !error.message.includes('IMPORT_SECRET'),
  );
  const pending = bridge.read();
  const rejected = assert.rejects(pending, { code: 'NATIVE_MODEL_CATALOG_CLOSED' });
  await bridge.close();
  await rejected;
  const missing = createNativeModelCatalog({ cli: null, agentHome: '' });
  await assert.rejects(missing.read(), { code: 'NATIVE_MODEL_CATALOG_UNAVAILABLE' });
  await missing.close();
});
