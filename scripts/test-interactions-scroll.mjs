import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { interactiveStudio } from './fixtures/interactive-studio.mjs';

let releaseQuestion;
const questionGate = new Promise((resolve) => (releaseQuestion = resolve));
const fixture = await interactiveStudio({ beforeQuestion: () => questionGate });
const out = resolve(process.env.PRIME_STUDIO_REVIEW_DIR || '.local/interactive-review/scroll');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const watching = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
    locale: 'fr-FR',
    reducedMotion: 'reduce',
  });
  await watching.addInitScript((cwd) => {
    localStorage.setItem('prime-studio.selection', JSON.stringify({ cwd, projectOverview: false }));
  }, fixture.cwd);
  await watching.goto(fixture.url);
  await watching.locator('#allow-questions').check();
  await watching.locator('#composer').fill('Préparer un aperçu et demander ma préférence.');
  await watching.locator('#send-button').click();
  await expect
    .poll(
      () =>
        watching
          .locator('.inline-image-open img')
          .first()
          .evaluate((img) => img.naturalWidth),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);

  const reading = await browser.newPage({
    viewport: { width: 390, height: 844 },
    locale: 'fr-FR',
    reducedMotion: 'reduce',
  });
  const selection = await watching.evaluate(() => localStorage.getItem('prime-studio.selection'));
  await reading.addInitScript((selection) => {
    localStorage.setItem('prime-studio.selection', selection);
  }, selection);
  await reading.goto(fixture.url);
  await expect
    .poll(
      () =>
        reading
          .locator('.inline-image-open img')
          .first()
          .evaluate((img) => img.naturalWidth),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  await reading.locator('#conversation-scroll').evaluate((scroll) => {
    scroll.scrollTop = 0;
  });
  await expect(reading.locator('#scroll-bottom')).toBeVisible();
  const before = await reading.locator('#conversation-scroll').evaluate((scroll) => scroll.scrollTop);
  releaseQuestion();

  const question = '.agent-question:not(.question-resolved)';
  await expect(watching.locator(question)).toBeInViewport({ ratio: 0.9, timeout: 30000 });
  await expect(reading.locator(question)).toBeVisible();
  await expect(reading.locator('#scroll-bottom')).toBeVisible();
  const after = await reading.locator('#conversation-scroll').evaluate((scroll) => scroll.scrollTop);
  assert.equal(after, before, 'A question must not move a reader who scrolled up');
  await expect(reading.locator(question)).not.toBeInViewport();
  await watching.screenshot({ path: join(out, 'desktop-question-auto.png') });
  await reading.screenshot({ path: join(out, 'phone-reading-preserved.png') });
  await reading.locator('#scroll-bottom').click();
  await expect(reading.locator(question)).toBeInViewport({ ratio: 0.8 });
  await reading.screenshot({ path: join(out, 'phone-question-reached.png') });
  await writeFile(
    join(out, 'scroll-proof.json'),
    JSON.stringify(
      {
        passed: true,
        before,
        after,
        checks: [
          'Native question visible without manual scroll',
          'Reading position preserved',
          'Visible access to latest content',
          'Question reached on mobile',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Interactive scroll PASS', out);
} finally {
  releaseQuestion();
  await browser.close();
  await fixture.close();
}
