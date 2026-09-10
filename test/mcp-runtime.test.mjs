import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createMcpService } from '../lib/mcp-service.mjs';
import { mcpRevision } from '../lib/mcp-config.mjs';

function deferred() {
  let resolvePromise, reject;
  const promise = new Promise((done, fail) => {
    resolvePromise = done;
    reject = fail;
  });
  return { promise, resolve: resolvePromise, reject };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'prime-mcp-runtime é espaces-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const kernelRoot = join(root, 'persistent-app-data'),
    agentHome = join(root, 'agent-home'),
    packageDir = join(root, 'packaged-prime-agent'),
    calls = [];
  let config = { type: 'stdio', command: 'fixture-mcp', enabled: true };
  const store = {
    async get(name) {
      assert.equal(name, 'Unity_MCP_Vtrott');
      return { config: structuredClone(config) };
    },
  };
  async function pythonFile(path) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'fixture executable, never launched');
    return path;
  }
  async function ready(generation = 'generation-1', selectedRoot = kernelRoot) {
    const python = await pythonFile(
      join(
        selectedRoot,
        '.local/kernel-venv',
        generation,
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
    );
    await writeFile(join(selectedRoot, '.local/kernel-ready.json'), JSON.stringify({ schema: 2, python }));
    return python;
  }
  const options = {
    agentHome,
    environment: { PRIME_AGENT_GUI_KERNEL_ROOT: kernelRoot },
    store,
    discoverRuntime: () => ({ packageDir }),
    prepareKernel: () => assert.fail('A ready runtime must not be prepared again'),
    spawnProcess(command, args, spawnOptions) {
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = (source) => {
        calls.push({ command, args, options: spawnOptions, payload: JSON.parse(source) });
        queueMicrotask(() => {
          child.stdout.emit('data', JSON.stringify({ tools: [{ name: 'get_scene' }], total: 1 }));
          child.exitCode = 0;
          child.emit('close', 0);
        });
      };
      return child;
    },
  };
  const service = (overrides = {}) => {
    const result = createMcpService({ ...options, ...overrides });
    t.after(() => result.close());
    return result;
  };
  return {
    root,
    kernelRoot,
    agentHome,
    packageDir,
    calls,
    options,
    service,
    ready,
    pythonFile,
    request: () => ({ name: 'Unity_MCP_Vtrott', revision: mcpRevision(config) }),
    change: (values) => {
      config = { ...config, ...values };
    },
  };
}

test('MCP probes use the packaged application persistent runtime instead of the source directory', async (t) => {
  const f = await fixture(t),
    python = await f.ready(),
    service = f.service();
  const result = await service.probe(f.request());
  assert.equal(result.total, 1);
  assert.deepEqual(result.tools, [{ name: 'get_scene' }]);
  assert.equal(f.calls[0].payload.python, python);
  assert.equal(f.calls[0].payload.agentHome, f.agentHome);
  assert.equal(f.calls[0].options.env.PRIME_AGENT_CODING_AGENT_DIR, f.agentHome);
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.equal(f.calls[0].options.shell, false);
});

test('MCP resolves the validated runtime when probing, including after a later generation is prepared', async (t) => {
  const f = await fixture(t),
    service = f.service();
  const first = await f.ready('first-generation');
  await service.probe(f.request());
  const second = await f.ready('second-generation');
  await service.probe(f.request());
  assert.deepEqual(
    f.calls.map((call) => call.payload.python),
    [first, second],
  );
});

test('an explicit kernel root wins over the environment root', async (t) => {
  const f = await fixture(t),
    root = join(f.root, 'selected-runtime'),
    python = await f.ready('selected-generation', root);
  const service = f.service({ kernelRoot: root });
  await service.probe(f.request());
  assert.equal(f.calls[0].payload.python, python);
});

test('the first MCP probe prepares its missing core runtime automatically without project skills', async (t) => {
  const f = await fixture(t),
    environment = {
      ...f.options.environment,
      PRIME_AGENT_CLI: join(f.packageDir, 'cli.js'),
      PRIME_AGENT_INTERNAL_PARENT_ID: 'must-not-leak',
    };
  let prepared = 0,
    python;
  const service = f.service({
    environment,
    discoverRuntime(explicit) {
      assert.equal(explicit, environment.PRIME_AGENT_CLI);
      return { packageDir: f.packageDir };
    },
    async prepareKernel(options) {
      prepared++;
      assert.equal(options.root, f.kernelRoot);
      assert.equal(options.packageDir, f.packageDir);
      assert.equal(options.agentHome, f.agentHome);
      assert.deepEqual(options.pythonSkills, []);
      assert.equal(options.env.PRIME_AGENT_CODING_AGENT_DIR, f.agentHome);
      assert.equal(options.env.PRIME_AGENT_INTERNAL_PARENT_ID, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      python = await f.ready();
      return python;
    },
  });
  await service.probe(f.request());
  await service.probe(f.request());
  assert.equal(prepared, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].payload.python, python);
});

test('explicit Python selection remains authoritative over both environment and automatic runtime', async (t) => {
  const f = await fixture(t),
    automatic = await f.ready(),
    explicit = await f.pythonFile(join(f.root, 'manual-python')),
    fromEnvironment = await f.pythonFile(join(f.root, 'environment-python'));
  const environment = { ...f.options.environment, PRIME_AGENT_KERNEL_PYTHON: fromEnvironment };
  await f.service({ environment }).probe(f.request());
  await f.service({ environment, python: explicit }).probe(f.request());
  assert.deepEqual(
    f.calls.map((call) => call.payload.python),
    [fromEnvironment, explicit],
  );
  assert.notEqual(automatic, explicit);
});

test('a missing explicit Python is reported without silently replacing the configured interpreter', async (t) => {
  const f = await fixture(t);
  await f.ready();
  await assert.rejects(f.service({ python: join(f.root, 'missing-python') }).probe(f.request()), {
    status: 503,
  });
  assert.equal(f.calls.length, 0);
});

test('a disabled MCP server does not trigger runtime installation', async (t) => {
  const f = await fixture(t);
  f.change({ enabled: false });
  await assert.rejects(f.service().probe(f.request()), { status: 400 });
  assert.equal(f.calls.length, 0);
});

test('configuration changes during runtime preparation prevent a stale MCP connection', async (t) => {
  const f = await fixture(t),
    entered = deferred(),
    release = deferred();
  const service = f.service({
    async prepareKernel() {
      entered.resolve();
      await release.promise;
      return f.ready();
    },
  });
  const probe = service.probe(f.request());
  const rejection = assert.rejects(probe, { status: 409 });
  await entered.promise;
  f.change({ command: 'different-mcp' });
  release.resolve();
  await rejection;
  assert.equal(f.calls.length, 0);
});

test('disabling a server while its runtime prepares prevents worker launch', async (t) => {
  const f = await fixture(t),
    entered = deferred(),
    release = deferred();
  const service = f.service({
    async prepareKernel() {
      entered.resolve();
      await release.promise;
      return f.ready();
    },
  });
  const rejection = assert.rejects(service.probe(f.request()), { status: 409 });
  await entered.promise;
  f.change({ enabled: false });
  release.resolve();
  await rejection;
  assert.equal(f.calls.length, 0);
});

test('closing MCP management aborts pending runtime preparation and never spawns a worker', async (t) => {
  const f = await fixture(t),
    entered = deferred();
  let signal;
  const service = f.service({
    prepareKernel(options) {
      signal = options.signal;
      entered.resolve();
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('preparation aborted')), { once: true });
      });
    },
  });
  const rejection = assert.rejects(service.probe(f.request()), { status: 503 });
  await entered.promise;
  service.close();
  await rejection;
  assert.equal(signal.aborted, true);
  assert.equal(f.calls.length, 0);
  await assert.rejects(service.probe(f.request()), { status: 503 });
});

test('an unavailable Prime Agent runtime fails without launching a probe or optional setup', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service({ discoverRuntime: () => null }).probe(f.request()), { status: 503 });
  assert.equal(f.calls.length, 0);
});

test('a failed automatic preparation releases its probe slot and can be retried successfully', async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  const service = f.service({
    async prepareKernel() {
      attempts++;
      if (attempts <= 2) throw new Error('temporary package download failure');
      return f.ready();
    },
  });
  await assert.rejects(service.probe(f.request()), { status: 503 });
  await assert.rejects(service.probe(f.request()), { status: 503 });
  assert.equal((await service.probe(f.request())).total, 1);
  assert.equal(attempts, 3);
  assert.equal(f.calls.length, 1);
});
