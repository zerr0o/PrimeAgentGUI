// Real Tauri/WebView2 plus the actual Windows IFileDialog. Every native action
// targets this isolated process and a dialog owned by its attested main HWND.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../server.mjs';

assert.equal(process.platform, 'win32', 'This test requires real Windows/WebView2');
assert.ok(process.env.PRIME_STUDIO_TEST_EXE, 'Provide a separately built, isolated Tauri executable');
const exe = resolve(process.env.PRIME_STUDIO_TEST_EXE);
const identity = 'com.primeagent.studio.folder-picker-test';
const binary = await readFile(exe);
assert.ok(
  binary.includes(Buffer.from(identity)),
  `Test executable must embed the isolated identity ${identity}`,
);
const root = await mkdtemp(join(tmpdir(), 'prime-native-folder-'));
const cwd = join(root, 'Atelier');
const selected = join(root, "Projet é & [notes], l'atelier 中文");
const sessionDir = join(root, 'sessions');
const agentHome = join(root, 'agent');
const dataRoot = join(root, 'desktop');
const evidenceDir = resolve('test-results');
await Promise.all(
  [cwd, selected, sessionDir, agentHome, dataRoot, evidenceDir].map((path) =>
    mkdir(path, { recursive: true }),
  ),
);
await writeFile(join(dataRoot, 'desktop.json'), '{"started":true}');
let agentStarts = 0;
let httpPickerCalls = 0;
const mutations = [];
const app = createApp({
  cwd,
  initialCwd: cwd,
  sessionDir,
  agentHome,
  dataDir: join(root, 'server-data'),
  runtime: {
    getStatus: async () => ({ available: true, version: 'fixture' }),
    getModels: async () => ({ models: [] }),
    start: async () => {
      agentStarts++;
      throw new Error('The native picker test must never run an agent');
    },
    close: async () => {},
  },
  directoryPicker: {
    pick: async () => {
      httpPickerCalls++;
      throw new Error('The desktop must use native IPC, not the HTTP picker');
    },
    close: () => {},
  },
});
app.server.on('request', (request) => {
  if (request.method === 'POST') mutations.push(request.url);
});
await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${app.server.address().port}`;
const reservation = createServer();
await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
const debugPort = reservation.address().port;
await new Promise((done) => reservation.close(done));
const child = spawn(exe, [], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    PRIME_STUDIO_DESKTOP_DATA_ROOT: dataRoot,
    PRIME_STUDIO_DESKTOP_PORT: String(app.server.address().port),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
  },
});
let browser;
let main;
let foregroundLimitation = null;
const checks = [];
const errors = [];
const nativeEvidence = [];
async function native(action, { path, screenshot } = {}) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    resolve('scripts/test-desktop-folder-picker.ps1'),
    '-TestProcessId',
    String(child.pid),
    '-ExpectedExecutable',
    exe,
    '-Action',
    action,
  ];
  if (main) args.push('-MainWindowHandle', String(main.hwnd));
  if (path) args.push('-SelectedPath', path);
  if (screenshot) args.push('-ScreenshotPath', screenshot);
  const result = await new Promise((done, reject) => {
    const helper = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    helper.stdout.setEncoding('utf8').on('data', (data) => {
      stdout += data;
    });
    helper.stderr.setEncoding('utf8').on('data', (data) => {
      stderr += data;
    });
    helper.on('error', reject);
    const timer = setTimeout(() => {
      helper.kill();
      reject(new Error(`Native helper timed out: ${action}`));
    }, 20000);
    helper.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr || stdout));
      try {
        done(JSON.parse(stdout.replace(/^\uFEFF/, '')));
      } catch (error) {
        reject(error);
      }
    });
  });
  if (!['main', 'focus'].includes(action)) nativeEvidence.push(result);
  return result;
}
async function assertNoMutation() {
  assert.equal(agentStarts, 0);
  assert.equal(httpPickerCalls, 0);
  assert.deepEqual(mutations, []);
  await assert.rejects(() => app.store.findProject(selected), { status: 404 });
}
try {
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null) throw new Error('The isolated executable exited unexpectedly');
        return fetch(`http://127.0.0.1:${debugPort}/json/version`)
          .then((response) => response.ok)
          .catch(() => false);
      },
      { timeout: 30000 },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  await expect
    .poll(
      () =>
        context
          .pages()
          .find((page) => page.url().startsWith(url))
          ?.url(),
      { timeout: 30000 },
    )
    .toBeTruthy();
  const page = context.pages().find((item) => item.url().startsWith(url));
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('#add-project')).toBeVisible();
  main = await native('main');
  assert.equal(main.visible, true);
  try {
    main = await native('focus');
    if (!main.foreground)
      foregroundLimitation =
        'Windows kept the test app outside the foreground after its targeted title-bar activation.';
  } catch (error) {
    foregroundLimitation = error.message;
  }
  assert.equal(await page.evaluate(() => window.__PRIME_STUDIO_DIRECTORY_PICKER__), true);
  await page.locator('#add-project').click();
  await page.locator('#project-cwd').fill(cwd);
  await page.locator('#project-name').fill('Nom personnel conservé');
  await page.locator('#project-browse').click();
  await expect(page.locator('#project-browse')).toBeDisabled();
  await expect(page.locator('#project-submit')).toBeDisabled();
  const first = await native('inspect', {
    screenshot: join(evidenceDir, 'desktop-folder-picker-native.png'),
  });
  assert.equal(first.dialog.owner, main.hwnd);
  assert.equal(first.dialog.visible, true);
  if (main.foreground) assert.equal(first.dialog.foreground, true);
  assert.equal(first.main.enabled, false, 'The native dialog must be modal to its Tauri owner');
  checks.push('Real visible Windows folder dialog, owned by the disabled Tauri main HWND');
  await assertNoMutation();
  await native('select', { path: selected });
  await expect(page.locator('#project-cwd')).toHaveValue(selected);
  await expect(page.locator('#project-name')).toHaveValue('Nom personnel conservé');
  await expect(page.locator('#project-browse')).toBeEnabled();
  await assertNoMutation();
  checks.push('Native Windows selection returns the complete Unicode path without creating a project');
  await page.locator('#project-browse').click();
  await expect(page.locator('#project-browse')).toBeDisabled();
  const second = await native('inspect', {
    screenshot: join(evidenceDir, 'desktop-folder-picker-reopened.png'),
  });
  assert.equal(second.dialog.owner, main.hwnd);
  if (main.foreground) assert.equal(second.dialog.foreground, true);
  await native('cancel');
  await expect(page.locator('#project-browse')).toBeEnabled();
  await expect(page.locator('#project-submit')).toBeEnabled();
  await expect(page.locator('#project-cwd')).toHaveValue(selected);
  await expect(page.locator('#project-name')).toHaveValue('Nom personnel conservé');
  await assertNoMutation();
  checks.push('The picker reopens; native Cancel preserves both form fields and releases the busy state');
  await page.screenshot({ path: join(evidenceDir, 'desktop-folder-picker-form.png') });
  await page.locator('#project-submit').click();
  await expect(page.locator('#project-dialog')).not.toBeVisible();
  assert.equal((await app.store.findProject(selected)).name, 'Nom personnel conservé');
  assert.deepEqual(mutations, ['/api/projects']);
  assert.equal(httpPickerCalls, 0);
  assert.equal(agentStarts, 0);
  assert.deepEqual(errors, []);
  checks.push('Explicit Add creates exactly one project; no HTTP picker request or agent start occurred');
  const report = {
    passed: true,
    foregroundProven: main.foreground && first.dialog.foreground && second.dialog.foreground,
    foregroundLimitation,
    identity,
    exe,
    pid: child.pid,
    root,
    url,
    main,
    checks,
    nativeEvidence,
    mutations,
    httpPickerCalls,
    agentStarts,
  };
  assert.equal(
    report.foregroundProven,
    true,
    foregroundLimitation || 'The visible test app and both native dialogs must be observed in the foreground',
  );
  await writeFile(join(evidenceDir, 'desktop-folder-picker.json'), JSON.stringify(report, null, 2));
  await rm(join(evidenceDir, 'desktop-folder-picker-failure.json'), { force: true });
  console.log(
    JSON.stringify({
      passed: true,
      foregroundProven: report.foregroundProven,
      checks,
      evidence: join(evidenceDir, 'desktop-folder-picker.json'),
    }),
  );
} catch (error) {
  await writeFile(
    join(evidenceDir, 'desktop-folder-picker-failure.json'),
    JSON.stringify(
      {
        error: error.stack,
        foregroundLimitation,
        identity,
        exe,
        pid: child.pid,
        root,
        main,
        checks,
        nativeEvidence,
        mutations,
        httpPickerCalls,
        agentStarts,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  child.kill();
  await new Promise((done) =>
    child.exitCode !== null || child.signalCode !== null ? done() : child.once('exit', done),
  );
  await browser?.close().catch(() => {});
  await app.close();
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
