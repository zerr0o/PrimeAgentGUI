import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server.mjs';

const root = await mkdtemp(join(tmpdir(), 'prime-folder-ui-'));
const cwd = join(root, 'Atelier'),
  selected = join(root, "Projet é & [notes], l'atelier");
await Promise.all([cwd, selected].map((p) => mkdir(p)));
let complete,
  pickerCalls = 0;
const app = createApp({
  initialCwd: cwd,
  agentHome: join(root, 'agent'),
  sessionDir: join(root, 'sessions'),
  dataDir: join(root, 'data'),
  runtime: {
    getStatus: async () => ({ available: true }),
    getModels: async () => ({ models: [] }),
    close: async () => {},
  },
  directoryPicker: {
    pick: async () => {
      pickerCalls++;
      return new Promise((done, reject) => {
        complete = { done, reject };
      });
    },
  },
});
await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.PRIME_STUDIO_TEST_BROWSER || 'msedge',
    headless: true,
  });
  const page = await browser.newPage({ locale: 'fr-FR', viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.locator('#add-project').click();
  await expect(page.locator('#project-browse')).toBeVisible();
  await page.locator('#project-cwd').fill(cwd);
  await page.locator('#project-name').fill('Mon nom personnalisé');
  await page.locator('#project-browse').click();
  await expect.poll(() => pickerCalls).toBe(1);
  await expect(page.locator('#project-browse')).toBeDisabled();
  await expect(page.locator('#project-submit')).toBeDisabled();
  complete.done({ cwd: null });
  await expect(page.locator('#project-browse')).toBeEnabled();
  await expect(page.locator('#project-cwd')).toHaveValue(cwd);
  await expect(page.locator('#project-name')).toHaveValue('Mon nom personnalisé');
  await page.locator('#project-browse').click();
  await expect.poll(() => pickerCalls).toBe(2);
  complete.done({ cwd: selected });
  await expect(page.locator('#project-cwd')).toHaveValue(selected);
  await expect(page.locator('#project-name')).toHaveValue('Mon nom personnalisé');
  await page.screenshot({ path: '.local/project-folder-desktop.png' });
  await page.locator('#project-browse').click();
  await expect.poll(() => pickerCalls).toBe(3);
  complete.reject(
    Object.assign(
      new Error('Impossible de sélectionner le dossier sur le PC. Réessayez ou saisissez son chemin.'),
      { status: 502 },
    ),
  );
  await expect(page.locator('#project-error')).toBeVisible();
  await expect(page.locator('#project-browse')).toBeEnabled();
  await page.locator('#project-browse').click();
  await expect.poll(() => pickerCalls).toBe(4);
  await page.locator('#project-dialog [data-close-dialog]').first().click();
  await page.locator('#add-project').click();
  await page.locator('#project-cwd').fill(cwd);
  complete.done({ cwd: selected });
  await expect(page.locator('#project-browse')).toBeEnabled();
  await expect(page.locator('#project-cwd')).toHaveValue(cwd);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/project-folder-narrow.png' });
  const dialog = await page.locator('#project-dialog').boundingBox();
  const button = await page.locator('#project-browse').boundingBox();
  expect(button.x + button.width).toBeLessThanOrEqual(dialog.x + dialog.width);
  await page.locator('#project-name').fill('Nouveau projet');
  await page.locator('#project-cwd').fill(selected);
  await page.locator('#project-submit').click();
  await expect(page.locator('#project-dialog')).not.toBeVisible();
  expect((await app.store.findProject(selected)).name).toBe('Nouveau projet');
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      passed: true,
      cancellation: true,
      selection: true,
      errorRecovery: true,
      staleSelectionIgnored: true,
      projectAdded: true,
    }),
  );
} finally {
  await browser?.close();
  await app.close();
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected fixture path');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
