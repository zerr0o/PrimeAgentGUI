import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStabilityFixture } from './fixtures/session-stability.mjs';

const fixture = await createStabilityFixture();
let browser;
const errors = [],
  checks = [];
try {
  browser = await chromium.launch({
    channel: process.env.PRIME_STUDIO_TEST_BROWSER || 'chrome',
    headless: true,
  });
  const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(fixture.url);
  const project = (name) => page.locator('.project-row').filter({ hasText: name });
  await project('SoundsPerfect').click();
  await page.locator('[data-session-id="stability-demo"].project-session-card').click();
  const cards = page.locator('.agent-message');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('native-ui-test-driver');
  await expect(cards.first()).toContainText('UI Automation');
  await expect(cards.first().locator('.agent-message-badge')).toHaveText('Sous-agent');
  await expect(cards.first().locator('.agent-message-body')).toHaveCSS('font-size', '14px');
  await expect(cards.first()).not.toContainText('Native envelope');
  await cards.first().locator('summary').click();
  await expect(cards.first().locator('dd').first()).toContainText('01a082a2');
  await cards.first().locator('summary').click();
  await page.locator('.live-queue > summary').click();
  const protectedRows = page.locator('.live-queue-agent');
  await expect(protectedRows).toHaveCount(2);
  await expect(protectedRows.locator('button,textarea')).toHaveCount(0);
  await expect(protectedRows.first()).toContainText('protégé');
  await expect(page.locator('.live-queue-item:not(.live-queue-agent) button')).toHaveCount(5);
  const protectedResponse = await context.request.post(
    fixture.url + '/api/live/sessions/stability-demo/queue',
    {
      data: {
        cwd: fixture.cwd,
        lane: 'steering',
        index: 0,
        expectedText: 'Agent message received: test',
        mutation: { type: 'delete' },
      },
    },
  );
  expect(protectedResponse.status()).toBe(409);
  checks.push('Cartes natives avec détails repliés, file automatique protégée dans l’interface et par l’API');
  await page.locator('.live-queue-item:not(.live-queue-agent) button').last().click();
  await expect(page.locator('.live-queue-item:not(.live-queue-agent)')).toHaveCount(0);
  checks.push('La suppression des messages humains reste fonctionnelle');
  const order = () => page.locator('.project-row').allTextContents();
  const before = await order();
  await project('SoundsPerfect').click({ button: 'right' });
  await page.locator('[data-project-action="up"]').click();
  await expect.poll(order).not.toEqual(before);
  const moved = await order();
  await page.reload();
  await expect.poll(order).toEqual(moved);
  checks.push('Ordre des projets modifié depuis le menu et conservé après rechargement');
  await mkdir(resolve('test-results'), { recursive: true });
  await page.screenshot({
    path: resolve('test-results/session-stability-desktop.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: resolve('test-results/session-stability-mobile.png'),
    animations: 'disabled',
  });
  checks.push('Absence de débordement horizontal à 390 px');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks }));
} finally {
  await browser?.close();
  await fixture.close();
}
