// Real WebView2 + Windows opener, isolated identity/data/ports and synthetic OAuth.
// No credentials or model calls. CDP drag events test browser file delivery; an
// Explorer-to-window gesture is checked separately because CDP bypasses OLE.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../server.mjs';

const baseline = process.argv.includes('--baseline');
const preview = process.argv.includes('--preview');
const exe = resolve(process.env.PRIME_STUDIO_TEST_EXE || 'src-tauri/target/debug/prime-agent-studio.exe');
const root = await mkdtemp(join(tmpdir(), 'prime-webview-interactions-'));
const cwd = join(root, 'Atelier'),
  sessionDir = join(root, 'sessions'),
  agentHome = join(root, 'agent');
await Promise.all([cwd, sessionDir, agentHome].map((path) => mkdir(path)));
const hits = [];
const external = createServer((request, response) => {
  hits.push({ path: request.url, agent: request.headers['user-agent'] });
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(
    '<title>Prime Studio — test de lien</title><p>Ouverture du navigateur confirmée. Vous pouvez fermer cet onglet.</p>',
  );
});
await new Promise((done) => external.listen(0, '127.0.0.1', done));
const externalUrl = `http://127.0.0.1:${external.address().port}`;
const job = {
  id: '12345678-abcd-1234-abcd-123456789012',
  provider: 'openai-codex',
  status: 'waiting',
  url: externalUrl + '/codex-authorize?state=synthetic',
  prompts: [],
  instructions: 'Connexion de test, aucun compte réel.',
};
await writeFile(
  join(sessionDir, 'demo.jsonl'),
  [
    { type: 'session', id: 'desktop-links', cwd, timestamp: new Date().toISOString() },
    {
      type: 'message',
      id: 'u1',
      parentId: null,
      message: { role: 'user', content: 'Vérifie les interactions Windows.' },
    },
    {
      type: 'message',
      id: 'a1',
      parentId: 'u1',
      message: {
        role: 'assistant',
        content: `Les contrôles sont prêts. [Ouvrir le lien web](${externalUrl}/markdown).`,
        stopReason: 'stop',
      },
    },
  ]
    .map(JSON.stringify)
    .join('\n') + '\n',
);
const documentPath = join(cwd, 'document é.txt');
await writeFile(documentPath, 'Pièce jointe de test Windows.');
const imagePath = join(cwd, 'image.png');
await writeFile(imagePath, await readFile(resolve('assets/prime-agent.png')));
const app = createApp({
  cwd,
  initialCwd: cwd,
  sessionDir,
  agentHome,
  dataDir: join(root, 'server-data'),
  runtime: {
    getStatus: async () => ({ available: true, version: 'fixture' }),
    getModels: async () => ({
      models: [
        { id: 'fixture/vision', name: 'Vision de test', provider: 'fixture', input: ['text', 'image'] },
      ],
      default: { model: 'fixture/vision' },
    }),
    start: async () => {
      throw new Error('This test must not run an agent');
    },
    close: async () => {},
  },
  providers: {
    list: async () => ({
      providers: [{ id: 'openai-codex', name: 'OpenAI Codex', methods: ['oauth'], configured: false }],
      busy: false,
    }),
    login: () => job,
    job: () => job,
    cancel: () => ({ ...job, status: 'cancelled' }),
    close: () => {},
  },
});
await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${app.server.address().port}`;
const reservation = createServer();
await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
const debugPort = reservation.address().port;
await new Promise((done) => reservation.close(done));
const dataRoot = join(root, 'desktop');
await mkdir(dataRoot);
await writeFile(join(dataRoot, 'desktop.json'), '{"started":true}');
const child = spawn(exe, preview ? [] : ['--background'], {
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
const errors = [],
  checks = [];
try {
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null)
          throw new Error('Test executable exited: build with the isolated Tauri identifier first');
        return fetch(`http://127.0.0.1:${debugPort}/json/version`)
          .then((r) => r.ok)
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
  const page = context.pages().find((page) => page.url().startsWith(url));
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.project-row').filter({ hasText: 'Atelier' }).click();
  await page.locator('[data-session-id="desktop-links"].project-session-card').click();
  if (preview) {
    await mkdir('.local', { recursive: true });
    await writeFile(
      '.local/desktop-interaction-preview.json',
      JSON.stringify({ root, cwd, url, debugPort, pid: child.pid }),
    );
    console.log(JSON.stringify({ root, cwd, url, debugPort, pid: child.pid }));
    await new Promise((done) => child.once('exit', done));
  } else {
    await page.getByRole('link', { name: 'Ouvrir le lien web' }).click();
    if (baseline) {
      await expect.poll(() => errors.join('\n')).toMatch(/opener|not allowed|denied/i);
      assert.equal(hits.filter((hit) => hit.path === '/markdown').length, 0);
      console.log('Baseline reproduced: external link swallowed by denied opener IPC.', errors);
    } else {
      await expect.poll(() => hits.some((hit) => hit.path === '/markdown')).toBe(true);
      assert.equal(page.url(), url + '/');
      assert.equal(context.pages().length, 1);
      checks.push('Markdown opens in the Windows default browser; Studio stays on its conversation');
      await page.locator('#open-settings').click();
      await page.locator('#settings-tab-models').click();
      await page.locator('#open-provider-settings').click();
      await page.getByRole('button', { name: 'Connecter un compte', exact: true }).click();
      await page.locator('#provider-auth-link').click();
      await expect.poll(() => hits.some((hit) => hit.path.startsWith('/codex-authorize'))).toBe(true);
      await expect(page.locator('#providers-dialog')).toBeVisible();
      await page.locator('#providers-close').click();
      await page.locator('#settings-dialog').evaluate((dialog) => dialog.close());
      checks.push(
        'OpenAI Codex OAuth link opens externally with the complete query; login form stays available',
      );
      const cdp = await context.newCDPSession(page);
      const box = await page.locator('#composer').boundingBox();
      const data = { items: [], files: [documentPath, imagePath], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop'])
        await cdp.send('Input.dispatchDragEvent', { type, x: box.x + 40, y: box.y + 25, data });
      await expect(page.locator('.image-draft')).toHaveCount(2);
      await expect(page.locator('.file-draft-name')).toContainText('document é.txt');
      await page.reload();
      await expect(page.locator('.image-draft')).toHaveCount(2);
      checks.push(
        'WebView2 receives image and Unicode filename drops; attachment draft persists after reload',
      );
      const clipboard = await page.evaluate(async () => {
        await navigator.clipboard.writeText('Prime Studio clipboard fixture');
        return true;
      });
      assert.equal(clipboard, true);
      checks.push('Clipboard write works in the Studio origin');
      const downloadPath = join(root, 'downloads');
      await mkdir(downloadPath);
      const browserCDP = await browser.newBrowserCDPSession();
      await browserCDP.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath,
        eventsEnabled: true,
      });
      const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
      await page.locator('#export-session').click();
      const download = await downloadPromise;
      assert.equal(await download.failure(), null);
      const exported = join(downloadPath, download.suggestedFilename());
      assert.match(await readFile(exported, 'utf8'), /Vérifie les interactions Windows/);
      checks.push('Conversation export downloads the complete Markdown blob in WebView2');
      await page.locator('#open-settings').click();
      await page.locator('#settings-tab-updates').click();
      const installed = JSON.parse(await readFile('package.json', 'utf8')).version;
      await expect(page.locator('#studio-update-app-version')).toHaveText(installed);
      await expect(page.locator('#studio-update-restart')).toBeDisabled();
      const denied = await page.evaluate(async () => {
        try {
          await window.__TAURI__.core.invoke('desktop_autostart', { enabled: true });
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(denied, true, 'Update access must not grant launcher settings permission');
      checks.push(
        'Preferences reach native update status; foreign server restart and launcher-only commands stay blocked',
      );
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/desktop-native-interactions.png' });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ passed: true, checks }));
    }
  }
} finally {
  child.kill();
  await new Promise((done) =>
    child.exitCode !== null || child.signalCode !== null ? done() : child.once('exit', done),
  );
  await browser?.close().catch(() => {});
  await app.close();
  external.closeAllConnections();
  await new Promise((done) => external.close(done));
  assert.equal(dirname(root), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
