import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!['index.html', 'desktop.js', 'desktop.css', 'icon.png'].includes(name)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'Content-Type',
    name.endsWith('.js')
      ? 'text/javascript'
      : name.endsWith('.css')
        ? 'text/css'
        : name.endsWith('.png')
          ? 'image/png'
          : 'text/html',
  );
  res.end(await readFile(join('desktop', name)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  channel: process.env.PRIME_STUDIO_TEST_BROWSER || 'msedge',
  headless: true,
});
try {
  for (const locale of ['fr-FR', 'en-US']) {
    const context = await browser.newContext({ locale });
    await context.addInitScript(() => {
      window.calls = [];
      window.mode = 'available';
      window.__TAURI__ = {
        core: {
          Channel: class {},
          invoke: async (command, args) => {
            window.calls.push(command);
            if (command === 'desktop_state')
              return { version: '2.8.0', started: false, imported: true, autostart: false };
            if (command === 'desktop_update_check') {
              if (window.mode === 'offline') throw 'check_failed';
              return {
                available: window.mode !== 'current',
                version: '2.9.0',
                notes: '<img src=x onerror=alert(1)>',
              };
            }
            if (command === 'desktop_update_install') {
              if (window.mode === 'failed') throw 'download_failed';
              window.updateChannel = args.onEvent;
              args.onEvent.onmessage({ stage: 'downloading', percent: 42 });
              return new Promise(() => {});
            }
          },
        },
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await expect(page.locator('#updates')).toBeHidden();
    await page.goto(url + '/?settings');
    await expect(page.locator('#app-version')).toHaveText('v2.8.0');
    await expect(page.locator('#update-install')).toBeHidden();
    await page.locator('#update-check').click();
    await expect(page.locator('#update-install')).toBeVisible();
    assert.equal((await page.evaluate(() => window.calls)).includes('desktop_update_install'), false);
    await expect(page.locator('#update-notes-body img')).toHaveCount(0);
    await page.evaluate(() => {
      window.mode = 'current';
    });
    await page.locator('#update-check').click();
    await expect(page.locator('#update-install')).toBeHidden();
    await page.evaluate(() => {
      window.mode = 'offline';
    });
    await page.locator('#update-check').click();
    await expect(page.locator('#update-status')).toHaveClass('failed');
    await expect(page.locator('#update-install')).toBeHidden();
    await page.evaluate(() => {
      window.mode = 'failed';
    });
    await page.locator('#update-check').click();
    await page.locator('#update-install').click();
    await expect(page.locator('#update-status')).toHaveClass('failed');
    await expect(page.locator('#update-install')).toBeEnabled();
    await page.evaluate(() => {
      window.mode = 'available';
    });
    await page.locator('#update-install').click();
    await expect(page.locator('#update-progress')).toHaveAttribute('value', '42');
    await expect(page.locator('#update-check')).toBeDisabled();
    await expect(page.locator('#update-install')).toBeDisabled();
    await page.evaluate(() => window.updateChannel.onmessage({ stage: 'verifying' }));
    await expect(page.locator('#update-progress')).not.toHaveAttribute('value');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'Updater UI passed in FR/EN: explicit install, safe notes, no update, offline, failure retry, progress and duplicate prevention.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
