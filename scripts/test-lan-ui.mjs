// Opt-in browser check against an already running LAN gateway. Never starts an agent.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT } from './launcher-common.mjs';
const config = JSON.parse(await readFile(join(APP_ROOT, '.local', 'lan-access.json'), 'utf8'));
const code = process.env.PRIME_STUDIO_TEST_CODE;
if (!code) throw new Error('PRIME_STUDIO_TEST_CODE est requis pour ce test facultatif.');
const url = `http://${config.host}:${config.port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const denied = await page.request.get(url + '/api/bootstrap');
  expect(denied.status()).toBe(401);
  await page.goto(url);
  await expect(page.locator('#code')).toBeVisible();
  await mkdir(join(APP_ROOT, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(APP_ROOT, 'test-results', 'lan-login.png'), animations: 'disabled' });
  await page.locator('#code').fill(code);
  await page.getByRole('button', { name: 'Ouvrir le studio' }).click();
  await expect(page.locator('#connection-label')).toContainText('connecté');
  const data = await (await page.request.get(url + '/api/bootstrap')).json();
  const readOnly = config.readOnly !== false;
  expect(data.preferences).toMatchObject({ remote: true, readOnly });
  await expect(page.locator('#remote-view-banner')).toBeVisible();
  await expect(page.locator('#remote-view-banner')).toContainText(
    readOnly ? 'lecture seule' : 'contrôle complet',
  );
  // An empty prompt is rejected before runtime.start; this cannot call a provider.
  const rejected = await page.request.post(url + '/api/runs', {
    data: { cwd: data.projects[0]?.cwd, message: '' },
  });
  expect(rejected.status()).toBe(readOnly ? 405 : 400);
  await page.locator('#toggle-sidebar').click();
  await expect(page.locator('#session-search')).toBeVisible();
  await page.locator('#session-search').fill('');
  if (readOnly) {
    await expect(page.locator('#new-session')).toBeHidden();
    await expect(page.locator('#add-project')).toBeHidden();
  } else {
    await expect(page.locator('#new-session')).toBeVisible();
    await expect(page.locator('#add-project')).toBeVisible();
  }
  const selectedProject =
    data.projects.find((project) => project.sessions.some((session) => !session.archived)) ||
    data.projects[0];
  expect(selectedProject).toBeTruthy();
  await page.locator('#project-list .project-row').filter({ hasText: selectedProject.name }).first().click();
  await expect(page.locator('#project-overview')).toBeVisible();
  await expect(page.locator('#project-overview-title')).toContainText(selectedProject.name);
  await expect(page.locator('#welcome')).toBeHidden();
  const selectedSession = selectedProject.sessions.find((session) => !session.archived);
  if (selectedSession) {
    const card = page.locator(
      `#project-session-list .project-session-card[data-session-id="${selectedSession.id}"]`,
    );
    await expect(card.first()).toBeVisible();
    await card.first().click();
    await expect(page.locator('#messages')).toBeVisible();
    await expect(page.locator('#header-session')).toContainText(selectedSession.title);
    if (readOnly) await expect(page.locator('#composer')).toBeHidden();
    else await expect(page.locator('#composer')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: join(APP_ROOT, 'test-results', 'lan-mobile.png'), animations: 'disabled' });
  await writeFile(
    join(APP_ROOT, 'test-results', 'lan-ui-report.json'),
    JSON.stringify(
      {
        passed: true,
        url,
        readOnly,
        projects: data.projects.length,
        checks: [
          'login',
          'private API',
          readOnly ? 'read-only UI' : 'full control UI',
          readOnly ? 'mutation rejected' : 'empty prompt rejected without starting an agent',
          'mobile layout',
          'project sessions visible in main mobile view',
          'session browsing',
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, url, readOnly }));
} finally {
  await browser.close();
}
