// Tests the real executable and detached server lifecycle; no UI automation or paid model calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { preferencesFixture } from './preview-preferences.mjs';
import { probeHealth } from './launcher-common.mjs';

const exe = resolve(process.argv[2] || 'src-tauri/target/debug/prime-agent-studio.exe');
const temp = await mkdtemp(join(tmpdir(), 'prime-native-test-'));
const children = [];
let backend;
async function until(fn, message) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(message);
}
async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function launch(dataRoot, port) {
  await mkdir(dataRoot, { recursive: true });
  await writeFile(join(dataRoot, 'desktop.json'), JSON.stringify({ started: true }));
  const child = spawn(exe, ['--background'], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PRIME_STUDIO_DESKTOP_DATA_ROOT: dataRoot,
      PRIME_STUDIO_DESKTOP_PORT: String(port),
      PRIME_AGENT_CODING_AGENT_DIR: join(temp, 'agent'),
      PRIME_AGENT_SESSION_DIR: join(temp, 'sessions'),
    },
  });
  children.push(child);
  child.once('error', (e) => {
    child.launchError = e;
  });
  const ready = await until(async () => {
    if (child.launchError) throw child.launchError;
    if (child.exitCode !== null) throw new Error('Native app exited before startup');
    return JSON.parse(await readFile(join(dataRoot, 'backend.json'), 'utf8').catch(() => 'null'));
  }, 'Native startup timed out');
  return { child, ready };
}
async function quit(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await until(() => child.exitCode !== null || child.signalCode !== null, 'Native exit timed out');
}
let finish,
  cancelled = 0;
const fixture = await preferencesFixture({
  runtime: {
    getStatus: async () => ({ available: true }),
    getModels: async () => ({ models: [] }),
    start: async () => ({
      done: new Promise((r) => (finish = r)),
      cancel: async () => {
        cancelled++;
        finish({ status: 'stopped' });
      },
    }),
    close: async () => finish?.({ status: 'completed' }),
  },
});
try {
  await mkdir(join(temp, 'agent'));
  await mkdir(join(temp, 'sessions'));
  const bootstrap = await (await fetch(fixture.url + '/api/bootstrap')).json();
  const response = await fetch(fixture.url + '/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: bootstrap.projects[0].cwd, message: 'Keep working' }),
  });
  assert.equal(response.status, 201);
  const run = await response.json();
  const running = await launch(join(temp, 'reuse'), Number(new URL(fixture.url).port));
  assert.equal(running.ready.reused, true);
  assert.equal(running.ready.pid, process.pid);
  await quit(running.child);
  assert.equal(fixture.app.runs.get(run.id).status, 'running');
  assert.equal(cancelled, 0);
  const port = await freePort(),
    dataRoot = join(temp, 'cold');
  const cold = await launch(dataRoot, port);
  backend = cold.ready;
  assert.equal(cold.ready.reused, false);
  const before = await probeHealth(port);
  assert.equal(before.state, 'ready');
  const second = spawn(exe, ['--background'], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PRIME_STUDIO_DESKTOP_DATA_ROOT: dataRoot,
      PRIME_STUDIO_DESKTOP_PORT: String(port),
    },
  });
  children.push(second);
  await until(() => second.exitCode !== null, 'Second native instance did not exit');
  assert.equal(second.exitCode, 0);
  await quit(cold.child);
  assert.equal((await probeHealth(port)).health.instanceId, before.health.instanceId);
  await rm(join(dataRoot, 'backend.json'));
  const reopened = await launch(dataRoot, port);
  assert.equal(reopened.ready.reused, true);
  assert.equal(reopened.ready.pid, backend.pid);
  await quit(reopened.child);
  assert.equal((await probeHealth(port)).health.instanceId, before.health.instanceId);
  console.log(
    'Native executable passed: existing active run preserved; cold detached startup; single instance; app exit and relaunch preserve server PID/instance.',
  );
} finally {
  for (const child of children) await quit(child).catch(() => {});
  if (backend) {
    const health = await probeHealth(backend.port);
    if (health.state === 'ready' && health.health.pid === backend.pid) process.kill(backend.pid);
  }
  await fixture.close();
  if (dirname(temp) !== resolve(tmpdir())) throw new Error('Unexpected test directory');
  await rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
