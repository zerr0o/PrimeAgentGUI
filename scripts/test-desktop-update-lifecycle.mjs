// Real Tauri commands and detached processes; isolated state, no provider or installer calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { startServer } from './start-server.mjs';
import { stopServer } from './stop-server.mjs';
import { probeHealth } from './launcher-common.mjs';

const root = await mkdtemp(join(tmpdir(), 'studio-native-update-'));
const dataRoot = join(root, 'desktop'),
  dataDir = join(dataRoot, 'data'),
  oldRoot = join(root, 'old');
const sessionDir = join(root, 'sessions'),
  agentHome = join(root, 'agent'),
  project = join(root, 'Atelier');
await Promise.all(
  [dataDir, oldRoot, sessionDir, agentHome, project].map((path) => mkdir(path, { recursive: true })),
);
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const freePort = async () => {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
};
const port = await freePort(),
  url = `http://127.0.0.1:${port}`;
await writeFile(
  join(dataDir, 'workspace.json'),
  JSON.stringify({
    projects: [{ cwd: project, name: 'Atelier', pinned: false }],
    removedProjects: [],
    sessions: {},
  }),
);
const history =
  JSON.stringify({ type: 'session', id: 'native-update-demo', cwd: project }) +
  '\n' +
  JSON.stringify({
    type: 'message',
    id: 'u1',
    parentId: null,
    message: { role: 'user', content: 'Session préservée.' },
  }) +
  '\n';
await writeFile(join(sessionDir, 'demo.jsonl'), history);
await writeFile(
  join(oldRoot, 'server.mjs'),
  `
  import { createServer } from 'node:http';
  createServer((req, res) => {
    if (req.url === '/api/health') res.end(JSON.stringify({service:'prime-agent-gui',status:'ok',pid:process.pid,instanceId:process.env.PRIME_AGENT_GUI_INSTANCE,version:'2.8.1'}));
    else if (req.url === '/api/runs') res.end(JSON.stringify({runs:[{id:'synthetic',status:'running'}]}));
    else {res.setHeader('Content-Type','text/html');res.end('<title>Isolated old Studio</title><p>Synthetic running agent</p>');}
  }).listen(Number(process.env.PORT),'127.0.0.1');
`,
);
let child, browser;
async function launch() {
  const debugPort = await freePort();
  await writeFile(join(dataRoot, 'desktop.json'), '{"started":true}');
  child = spawn(
    resolve(process.env.PRIME_STUDIO_TEST_EXE || 'src-tauri/target/debug/prime-agent-studio.exe'),
    ['--background'],
    {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PRIME_STUDIO_DESKTOP_DATA_ROOT: dataRoot,
        PRIME_STUDIO_DESKTOP_PORT: String(port),
        PRIME_AGENT_CODING_AGENT_DIR: agentHome,
        PRIME_AGENT_SESSION_DIR: sessionDir,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
      },
    },
  );
  await expect
    .poll(
      () =>
        fetch(`http://127.0.0.1:${debugPort}/json/version`)
          .then((r) => r.ok)
          .catch(() => false),
      { timeout: 30000 },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  await expect
    .poll(
      () =>
        browser
          .contexts()[0]
          .pages()
          .some((p) => p.url().startsWith(url)),
      { timeout: 45000 },
    )
    .toBe(true);
  return browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith(url));
}
async function quit() {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await new Promise((done) => child.once('exit', done));
  }
  await browser?.close().catch(() => {});
  browser = undefined;
}
try {
  const old = await startServer({
    root: oldRoot,
    port,
    env: { ...process.env, PRIME_AGENT_GUI_DATA_DIR: dataDir },
  });
  await writeFile(join(dataRoot, 'restart-after-update.json'), JSON.stringify({ version }));
  const page = await launch();
  await expect.poll(() => page.url()).toContain('settings=updates');
  assert.equal((await probeHealth(port)).health.pid, old.pid);
  const status = await page.evaluate(() => window.__TAURI__.core.invoke('desktop_update_status'));
  assert.equal(status.appVersion, version);
  assert.equal(status.activeRuns, 1);
  assert.equal(status.managed, true);
  const held = await page.evaluate(() =>
    window.__TAURI__.core.invoke('desktop_server_restart', { force: false }),
  );
  assert.equal(held.reason, 'agents_running');
  assert.equal((await probeHealth(port)).health.pid, old.pid);
  await page.evaluate(() => {
    void window.__TAURI__.core.invoke('desktop_server_restart', { force: true });
  });
  await expect.poll(async () => (await probeHealth(port)).health?.version, { timeout: 45000 }).toBe(version);
  await expect(page.locator('#studio-update-app-version')).toHaveText(version, { timeout: 30000 });
  await expect(page.locator('#studio-update-server-version')).toHaveText(version);
  const overview = await (await fetch(url + '/api/overview')).json();
  assert.ok(overview.projects.some((p) => p.cwd === project));
  assert.equal(await readFile(join(sessionDir, 'demo.jsonl'), 'utf8'), history);
  const currentPid = (await probeHealth(port)).health.pid;
  await quit();
  assert.equal((await probeHealth(port)).health.pid, currentPid);
  await writeFile(join(dataRoot, 'restart-after-update.json'), JSON.stringify({ version }));
  await launch();
  assert.notEqual((await probeHealth(port)).health.pid, currentPid);
  assert.equal((await probeHealth(port)).health.version, version);
  assert.equal(await readFile(join(dataRoot, 'restart-after-update.json')).catch(() => null), null);
  console.log(
    'Native update lifecycle passed: active server deferred, confirmation required, real restart to installed version, projects/history preserved, idle post-update restart.',
  );
} finally {
  await quit();
  await stopServer({ root: oldRoot, dataDir });
  assert.equal(dirname(root), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
