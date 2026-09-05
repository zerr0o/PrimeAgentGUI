// Real browser, manifest and service worker; isolated data and no native agent.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server.mjs';
import { createLanGateway, hashAccessCode } from '../lib/lan.mjs';
import { PWA_PUBLIC_PATHS } from '../lib/pwa.mjs';

const dir = await mkdtemp(join(tmpdir(), 'prime-pwa-ui-'));
const sessionDir = join(dir, 'sessions'),
  agentHome = join(dir, 'agent');
await Promise.all([mkdir(sessionDir), mkdir(agentHome)]);
const app = createApp({
  sessionDir,
  agentHome,
  dataDir: join(dir, 'data'),
  initialCwd: dir,
  runtime: {
    async getStatus() {
      return { available: true, version: 'fixture' };
    },
    async getModels() {
      return { models: [], default: {} };
    },
    async start() {
      throw new Error('This PWA test must not launch an agent.');
    },
    async close() {},
  },
});
await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
const code = '12345678',
  salt = 'a'.repeat(32);
const gateway = createLanGateway({
  host: '127.0.0.1',
  upstreamPort: app.server.address().port,
  config: { salt, codeHash: hashAccessCode(code, salt), readOnly: false },
});
await new Promise((done) => gateway.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${gateway.address().port}`;
// A different site reproduces links/PWA launches that retain cross-site navigation metadata.
const entry = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<a href="${url}">Ouvrir le Studio</a>`);
});
await new Promise((done) => entry.listen(0, '127.0.0.1', done));
const entryUrl = `http://localhost:${entry.address().port}`;
const navigationRequests = [];
gateway.prependListener('request', (req, res) => {
  if (req.url !== '/') return;
  const navigation = {
    method: req.method,
    site: req.headers['sec-fetch-site'],
    mode: req.headers['sec-fetch-mode'],
    destination: req.headers['sec-fetch-dest'],
    origin: req.headers.origin,
  };
  res.once('finish', () => navigationRequests.push({ ...navigation, status: res.statusCode }));
});
let browser;
const checks = [],
  errors = [];
try {
  const context = await chromium.launchPersistentContext(join(dir, 'browser-profile'), {
    channel: 'msedge',
    headless: true,
    viewport: { width: 390, height: 844 },
    locale: 'fr-FR',
  });
  browser = context.browser();
  await context.addInitScript(() => {
    // Native installation is checked through CDP; test the prompt UI deterministically below.
    addEventListener(
      'beforeinstallprompt',
      (event) => {
        if (event.isTrusted) event.stopImmediatePropagation();
      },
      true,
    );
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator('#code')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []);
  const definition = JSON.parse(manifest.data);
  assert.equal(definition.display, 'standalone');
  assert.equal(definition.scope, '/');
  const installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, []);
  checks.push('Chromium accepts the actual manifest, icons and installation criteria before login.');

  await page.goto(entryUrl);
  await page.getByRole('link', { name: 'Ouvrir le Studio' }).click();
  const reloaded = await page.reload();
  assert.equal(reloaded.status(), 200, JSON.stringify(navigationRequests));
  await expect(page.locator('#code')).toBeVisible();
  checks.push('External entry and reload with the active service worker preserve the login screen.');

  await page.locator('#pwa-install').click();
  await expect(page.locator('.pwa-dialog')).toContainText('Installer l’application');
  await page.getByRole('button', { name: 'Compris' }).click();
  await page.evaluate(() => {
    window.__installCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => {
      window.__installCalls++;
    };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    dispatchEvent(event);
  });
  await page.locator('#pwa-install').click();
  assert.equal(await page.evaluate(() => window.__installCalls), 1);
  await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('#pwa-install')).toBeHidden();
  checks.push('Install button opens browser guidance or the native prompt and hides after installation.');

  await page.locator('#code').fill(code);
  await page.getByRole('button', { name: 'Ouvrir le studio' }).click();
  await expect(page.locator('#connection-label')).toHaveText('Moteur connecté');
  assert.equal((await page.reload()).status(), 200);
  await expect(page.locator('#connection-label')).toHaveText('Moteur connecté');
  await page.locator('#toggle-sidebar').click();
  await page.locator('#new-session').click();
  await page.locator('#composer').fill('Brouillon privé à conserver');
  const cached = await page.evaluate(async () => {
    const entries = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        entries.push(new URL(request.url).pathname);
    return entries;
  });
  assert.ok(cached.length > 0);
  assert.ok(cached.every((path) => PWA_PUBLIC_PATHS.has(path)));
  assert.ok(!cached.some((path) => path.startsWith('/api/') || path === '/'));
  await context.setOffline(true);
  await page.goto(url);
  await expect(page.locator('h1')).toHaveText('Retrouvons votre Studio.');
  await expect(page.locator('body')).not.toContainText('Brouillon privé');
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch('/api/bootstrap');
        return true;
      } catch {
        return false;
      }
    }),
    false,
  );
  await mkdir(resolve('test-results'), { recursive: true });
  await page.screenshot({ path: resolve('test-results/pwa-offline-mobile.png') });
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Réessayer' }).click();
  await expect(page.locator('#connection-label')).toHaveText('Moteur connecté');
  await expect(page.locator('#composer')).toHaveValue('Brouillon privé à conserver');
  checks.push(
    'Offline launch shows a reconnection screen; only public resources are cached and the draft survives reconnection.',
  );
  await context.clearCookies();
  await page.reload();
  await expect(page.locator('#code')).toBeVisible();
  assert.equal((await context.request.get(url + '/api/bootstrap')).status(), 401);
  checks.push('After the access cookie expires, the service worker cannot bypass authentication.');
  assert.ok(
    navigationRequests.some(
      (request) =>
        request.site === 'cross-site' &&
        request.mode === 'navigate' &&
        request.destination === 'empty' &&
        request.status === 200,
    ),
  );
  assert.ok(!navigationRequests.some((request) => request.status === 403));

  const ios = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await ios.addInitScript(() =>
    addEventListener('beforeinstallprompt', (event) => event.stopImmediatePropagation(), true),
  );
  const iphone = await ios.newPage();
  await iphone.goto(url);
  await iphone.locator('#pwa-install').click();
  await expect(iphone.locator('.pwa-dialog')).toContainText('Safari');
  await expect(iphone.locator('.pwa-dialog')).toContainText('Sur l’écran d’accueil');
  await iphone.screenshot({ path: resolve('test-results/pwa-ios-guidance.png') });
  checks.push('iPhone guidance explains Safari and Add to Home Screen.');
  await ios.close();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve('test-results/pwa-ui.json'),
    JSON.stringify({ passed: true, checks, cached, installability, navigationRequests }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser?.close();
  entry.closeAllConnections();
  await new Promise((done) => entry.close(done));
  gateway.closeAllConnections();
  await new Promise((done) => gateway.close(done));
  await app.close();
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  await rm(dir, { recursive: true, force: true });
}
