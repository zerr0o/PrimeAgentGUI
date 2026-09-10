// Exercise the extracted desktop package, including first-use Python setup.
// All native settings and runtime files belong to one disposable test directory.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(process.argv[2], 'Usage: node scripts/test-mcp-packaged.mjs <extracted-studio-root>');
const studioRoot = await realpath(resolve(process.argv[2]));
assert.ok((await stat(join(studioRoot, 'lib/mcp-service.mjs'))).isFile());
const originalCwd = process.cwd();
const temporaryParent = await realpath(tmpdir());
const taskRoot = await mkdtemp(join(temporaryParent, 'prime-mcp-packaged-'));
const outside = join(taskRoot, 'outside');
const agentHome = join(taskRoot, 'agent');
const kernelRoot = join(taskRoot, 'persistent-runtime');
const auditPath = join(taskRoot, 'mcp-discovery.jsonl');
const fixturePath = join(taskRoot, 'mcp-server.mjs');
const settingsPath = join(agentHome, 'settings.json');
const markerPath = join(kernelRoot, '.local/kernel-ready.json');
const services = [];
const children = [];
const env = { ...process.env };
for (const key of Object.keys(env))
  if (
    ['PRIME_AGENT_KERNEL_PYTHON', 'NODE_OPTIONS', 'PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV'].includes(key) ||
    key.startsWith('PRIME_STUDIO_')
  )
    delete env[key];
Object.assign(env, {
  PRIME_AGENT_GUI_KERNEL_ROOT: kernelRoot,
  PRIME_AGENT_CODING_AGENT_DIR: agentHome,
  PRIME_AGENT_SESSION_DIR: join(agentHome, 'sessions'),
  MCP_TEST_TOKEN: 'fixture-private-token',
  PYTHONDONTWRITEBYTECODE: '1',
});

async function packageFingerprint() {
  const hash = createHash('sha256');
  let files = 0;
  async function visit(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      hash.update(JSON.stringify(relative(studioRoot, path)));
      if (entry.isSymbolicLink()) hash.update('link:').update(await readlink(path));
      else if (entry.isDirectory()) {
        hash.update('directory:');
        await visit(path);
      } else {
        const info = await stat(path);
        hash.update(`file:${info.size}:${info.mtimeMs}:`).update(await readFile(path));
        files++;
      }
    }
  }
  await visit(studioRoot);
  return { sha256: hash.digest('hex'), files };
}

async function records() {
  return (await readFile(auditPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
}

async function assertFixtureStopped() {
  const pids = (await records()).filter((item) => Number.isSafeInteger(item.pid)).map((item) => item.pid);
  for (let attempt = 0; attempt < 100; attempt++) {
    const active = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        assert.equal(error.code, 'ESRCH');
        return false;
      }
    });
    if (!active.length && children.every((child) => child.exitCode !== null || child.signalCode !== null))
      return;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.fail('The MCP probe left a fixture process running');
}

let timeout;
let expired = false;
let proof;
try {
  await Promise.all([mkdir(outside), mkdir(agentHome), mkdir(kernelRoot)]);
  await cp(join(sourceRoot, 'test/fixtures/mcp-server.mjs'), fixturePath);
  const packageBefore = await packageFingerprint();
  process.chdir(outside);
  assert.equal(process.cwd(), outside);
  assert.equal((await readdir(kernelRoot)).length, 0, 'The runtime must start empty');
  const { createMcpService } = await import(pathToFileURL(join(studioRoot, 'lib/mcp-service.mjs')));
  const createService = () => {
    const service = createMcpService({
      agentHome,
      environment: env,
      spawnProcess(command, args, options) {
        assert.equal(command, process.execPath);
        assert.equal(resolve(args[0]), join(studioRoot, 'scripts/mcp-probe-worker.mjs'));
        assert.equal(options.windowsHide, true);
        assert.equal(options.shell, false);
        const child = spawn(command, args, options);
        children.push(child);
        return child;
      },
    });
    services.push(service);
    return service;
  };
  const firstService = createService();
  await firstService.upsert({
    name: 'packaged-fixture',
    config: {
      type: 'stdio',
      command: process.execPath,
      args: [fixturePath, auditPath],
      cwd: outside,
      env: { TOKEN: { env: 'MCP_TEST_TOKEN' } },
      disabledTools: ['delete'],
    },
  });
  const settingsBefore = await readFile(settingsPath, 'utf8');
  const row = (await firstService.list()).servers.find((item) => item.name === 'packaged-fixture');
  assert.ok(row?.revision);
  const input = { name: row.name, revision: row.revision };
  const started = Date.now();
  timeout = setTimeout(() => {
    expired = true;
    for (const service of services) service.close();
  }, 180000);
  const first = await firstService.probe(input);
  assert.deepEqual(
    first.tools.map((tool) => tool.name),
    ['lookup'],
  );
  assert.equal(first.total, 1);
  const markerBefore = await readFile(markerPath, 'utf8');
  const marker = JSON.parse(markerBefore);
  assert.equal(marker.schema, 2);
  assert.deepEqual(marker.skills, [], 'MCP bootstrap must prepare only the native core runtime');
  const python = await realpath(marker.python);
  assert.ok(python.startsWith((await realpath(kernelRoot)) + sep));
  assert.ok((await stat(python)).isFile());
  const { stdout: pythonVersion } = await promisify(execFile)(python, ['--version'], {
    env,
    windowsHide: true,
    shell: false,
    timeout: 10000,
  });
  assert.match(pythonVersion.trim(), /^Python 3\.11\./);
  assert.equal(await readFile(settingsPath, 'utf8'), settingsBefore);
  firstService.close();
  await assertFixtureStopped();
  const generationsBefore = (await readdir(join(kernelRoot, '.local/kernel-venv'))).sort();
  const secondService = createService();
  const second = await secondService.probe(input);
  assert.deepEqual(
    second.tools.map((tool) => tool.name),
    ['lookup'],
  );
  assert.equal(second.total, 1);
  assert.equal(await readFile(markerPath, 'utf8'), markerBefore, 'A second service must reuse Python');
  assert.deepEqual((await readdir(join(kernelRoot, '.local/kernel-venv'))).sort(), generationsBefore);
  assert.equal(await readFile(settingsPath, 'utf8'), settingsBefore);
  secondService.close();
  await assertFixtureStopped();
  assert.equal(expired, false, 'The packaged MCP checks exceeded 180 seconds');
  clearTimeout(timeout);
  const audit = await records();
  const starts = audit.filter((item) => Number.isSafeInteger(item.pid));
  assert.equal(starts.length, 2);
  assert.ok(starts.every((item) => item.cwd === outside && item.environmentResolved));
  assert.deepEqual(
    audit.filter((item) => item.method).map((item) => item.method),
    [
      'initialize',
      'notifications/initialized',
      'tools/list',
      'initialize',
      'notifications/initialized',
      'tools/list',
    ],
  );
  assert.deepEqual(await packageFingerprint(), packageBefore, 'The extracted package must remain unchanged');
  proof = {
    passed: true,
    studioRoot,
    packageFiles: packageBefore.files,
    packageSha256: packageBefore.sha256,
    elapsedMs: Date.now() - started,
    tools: first.tools.map((tool) => tool.name),
    probes: 2,
    firstUseCorePythonPrepared: true,
    pythonVersion: pythonVersion.trim(),
    persistentPythonReused: true,
    outsideWorkingDirectory: true,
    hiddenWorkerProcesses: true,
    settingsUnchanged: true,
    packageUnchanged: true,
    toolCalls: 0,
    leftoverFixtureProcesses: 0,
  };
} finally {
  clearTimeout(timeout);
  for (const service of services) service.close();
  process.chdir(originalCwd);
  assert.equal(dirname(await realpath(taskRoot)), temporaryParent);
  assert.ok(basename(taskRoot).startsWith('prime-mcp-packaged-'));
  await rm(taskRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
console.log(JSON.stringify({ ...proof, temporaryDataRemoved: true }, null, 2));
