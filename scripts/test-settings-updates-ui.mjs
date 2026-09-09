import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createStabilityFixture } from './fixtures/session-stability.mjs';
import { mockDesktopUpdates } from './fixtures/desktop-updates.mjs';

const fixture = await createStabilityFixture();
const browser = await chromium.launch({
  channel: process.env.PRIME_STUDIO_TEST_BROWSER || 'chrome',
  headless: true,
});
try {
  await mkdir('test-results', { recursive: true });
  for (const locale of ['fr-FR', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 1440, height: 960 } });
    await mockDesktopUpdates(context);
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(fixture.url + '/?settings=updates');
    const $ = (id) => page.locator('#studio-update-' + id);
    await expect(page.locator('#settings-tab-updates')).toHaveAttribute('aria-selected', 'true');
    await expect($('app-version')).toHaveText('2.9.3');
    await expect($('server-version')).toHaveText('2.9.2');
    await $('check').click();
    await expect($('install')).toBeVisible();
    await expect($('notes-body').locator('img')).toHaveCount(0);
    await page.screenshot({ path: `test-results/settings-updates-${locale}.png` });
    await $('restart').click();
    await expect($('confirm')).toBeVisible();
    await expect($('cancel')).toBeFocused();
    await page.screenshot({ path: `test-results/settings-updates-warning-${locale}.png` });
    await page.keyboard.press('Escape');
    const restarts = () =>
      page.evaluate(() => window.updateFixture.calls.filter((c) => c.command === 'desktop_server_restart'));
    assert.equal((await restarts()).length, 0);
    await $('restart').click();
    await $('proceed').click();
    await expect.poll(async () => (await restarts()).length).toBe(1);
    assert.equal((await restarts())[0].force, true);
    await page.evaluate(() => (window.updateFixture.activeRuns = 0));
    await $('restart').click();
    await expect.poll(async () => (await restarts()).length).toBe(2);
    assert.equal((await restarts())[1].force, false);
    await page.evaluate(() => (window.updateFixture.mode = 'race'));
    await $('restart').click();
    await expect($('status')).toContainText(locale === 'fr-FR' ? 'entre-temps' : 'meantime');
    for (const mode of ['current', 'offline']) {
      await page.evaluate((mode) => (window.updateFixture.mode = mode), mode);
      await $('check').click();
      await expect($('install')).toBeHidden();
      if (mode === 'offline') await expect($('error')).toBeVisible();
    }
    await page.evaluate(() => {
      window.updateFixture.mode = 'invalid';
      window.updateFixture.activeRuns = 2;
    });
    await $('check').click();
    await $('install').click();
    await expect($('confirm')).toBeVisible();
    await $('cancel').click();
    assert.equal(
      await page.evaluate(() =>
        window.updateFixture.calls.some((c) => c.command === 'desktop_update_install'),
      ),
      false,
    );
    await $('install').click();
    await $('proceed').click();
    await expect($('error')).toBeVisible();
    await expect($('install')).toBeEnabled();
    await page.evaluate(() => {
      window.updateFixture.mode = 'available';
      window.updateFixture.activeRuns = 0;
    });
    await $('restart-after').uncheck();
    await $('install').click();
    await expect($('progress')).toHaveAttribute('value', '42');
    await expect($('check')).toBeDisabled();
    assert.equal(await page.evaluate(() => window.updateFixture.calls.at(-1).restartServer), false);
    await page.evaluate(() => window.updateFixture.channel.onmessage({ stage: 'verifying' }));
    await expect($('progress')).not.toHaveAttribute('value');
    assert.deepEqual(errors, []);
    await context.close();
  }
  const web = await browser.newPage();
  await web.goto(fixture.url + '/?settings=updates');
  await expect(web.locator('#studio-update-native')).toBeHidden();
  await expect(web.locator('#studio-update-browser')).toBeVisible();
  await web.close();
  console.log(
    'Updates preferences passed in FR/EN: versions, confirmation/cancel, idle restart, race refusal, progress, errors, literal notes, browser fallback.',
  );
} finally {
  await browser.close();
  await fixture.close();
}
