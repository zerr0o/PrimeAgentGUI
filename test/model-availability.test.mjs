import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelAvailability, isModelAvailabilityError } from '../lib/model-availability.mjs';

const models = [
  { id: 'openrouter/minimax/minimax-m3:free', provider: 'openrouter' },
  { id: 'openrouter/minimax/minimax-m3', provider: 'openrouter' },
  { id: 'prime-inference/minimax/minimax-m3', provider: 'prime-inference' },
];
const response = (ids) => Response.json({ data: ids.map((id) => ({ id })) });
const tick = () => new Promise((done) => setImmediate(done));

test('retired free IDs remain visible and distinct from paid IDs; requests are public and deduplicated', async (t) => {
  let calls = 0,
    finish;
  const service = createModelAvailability({
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://openrouter.ai/api/v1/models');
      assert.deepEqual(options.headers, { Accept: 'application/json' });
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  t.after(() => service.close());
  assert.equal((await service.apply(models)).refreshing, true);
  assert.equal((await service.apply(models, { refresh: true })).models[0].availability, 'unknown');
  assert.equal(calls, 1);
  finish(response(['minimax/minimax-m3']));
  await tick();
  const result = await service.apply(models);
  assert.deepEqual(
    result.models.map((m) => m.id),
    models.map((m) => m.id),
  );
  assert.deepEqual(
    result.models.map((m) => m.availability),
    ['unavailable', 'available', undefined],
  );
  assert.equal(result.refreshing, false);
  assert.equal(calls, 1);
});

test('offline, malformed, partial and expired catalogues do not falsely retire all models', async (t) => {
  let time = 0,
    outcome = response(['minimax/minimax-m3']);
  const service = createModelAvailability({
    now: () => time,
    ttl: 20,
    retryDelay: 1,
    maxStale: 100,
    fetchImpl: async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  });
  t.after(() => service.close());
  await service.apply(models);
  await tick();
  for (const next of [
    new Error('offline'),
    Response.json({ data: [] }),
    Response.json({ data: [{ id: 'other' }], has_more: true }),
    Response.json({ error: 'bad' }),
  ]) {
    time += 21;
    outcome = next;
    await service.apply(models);
    await tick();
    assert.equal((await service.apply(models)).models[1].availability, 'available');
  }
  time = 200;
  outcome = new Error('still offline');
  assert.equal((await service.apply(models)).models[0].availability, 'unknown');
});

test('manual refresh and normal TTL discover retirement without changing the selected identifier', async (t) => {
  let time = 0,
    live = ['minimax/minimax-m3:free'],
    calls = 0;
  const service = createModelAvailability({
    now: () => time,
    ttl: 100,
    retryDelay: 10,
    fetchImpl: async () => {
      calls++;
      return response(live);
    },
  });
  t.after(() => service.close());
  await service.apply(models);
  await tick();
  assert.equal((await service.apply(models)).models[0].availability, 'available');
  time = 11;
  live = ['minimax/minimax-m3'];
  await service.apply(models, { refresh: true });
  await tick();
  assert.equal((await service.apply(models)).models[0].availability, 'unavailable');
  time = 112;
  live.push('minimax/minimax-m3:free');
  await service.apply(models);
  await tick();
  assert.equal((await service.apply(models)).models[0].availability, 'available');
  assert.equal(calls, 3);
});

test('custom endpoints, routing aliases and presets are not treated as retired public SKUs', async (t) => {
  let calls = 0;
  const service = createModelAvailability({
    fetchImpl: async () => {
      calls++;
      return response(['minimax/minimax-m3']);
    },
  });
  t.after(() => service.close());
  assert.deepEqual(
    await service.apply(models, {
      customProviders: { openrouter: { baseUrl: 'https://myproxy.invalid/v1' } },
    }),
    { models, refreshing: false },
  );
  assert.equal(calls, 0);
  const aliases = [
    'openrouter/auto',
    '@preset/custom',
    'minimax/minimax-m3:nitro',
    'minimax/minimax-m3:free',
  ].map((id) => ({ id: `openrouter/${id}`, provider: 'openrouter' }));
  await service.apply(aliases);
  await tick();
  assert.deepEqual(
    (await service.apply(aliases)).models.map((m) => m.availability),
    ['unknown', 'unknown', 'available', 'unavailable'],
  );
});

test('only model availability failures trigger catalogue resync', () => {
  assert.equal(
    isModelAvailabilityError('404 This model is unavailable for free. The paid version is available now'),
    true,
  );
  assert.equal(isModelAvailabilityError('Invalid model: abc'), true);
  assert.equal(isModelAvailabilityError('404 file not found'), false);
  assert.equal(isModelAvailabilityError('429 Model rate limit exceeded'), false);
  assert.equal(isModelAvailabilityError('Insufficient credits'), false);
});

test('public and custom model endpoints can coexist without false retirements', async (t) => {
  let calls = 0;
  const service = createModelAvailability({
    fetchImpl: async () => {
      calls++;
      return response(['minimax/minimax-m3']);
    },
  });
  t.after(() => service.close());
  const entries = [
    { provider: 'openrouter', id: 'openrouter/private/local' },
    { provider: 'openrouter', id: 'openrouter/minimax/minimax-m3:free' },
    { provider: 'openrouter', id: 'openrouter/native-custom' },
  ];
  const options = {
    customProviders: {
      openrouter: {
        baseUrl: 'https://proxy.invalid/v1',
        models: [
          { id: 'private/local', baseUrl: 'http://127.0.0.1:1234/v1' },
          { id: 'minimax/minimax-m3:free', baseUrl: 'https://openrouter.ai/api/v1/' },
        ],
      },
    },
    skipIds: new Set(['openrouter/native-custom']),
  };
  await service.apply(entries, options);
  await tick();
  assert.deepEqual(
    (await service.apply(entries, options)).models.map((m) => m.availability),
    [undefined, 'unavailable', undefined],
  );
  assert.equal(calls, 1);
});
