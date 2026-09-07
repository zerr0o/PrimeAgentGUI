import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/screenshots/en');

// Called only by isolated demonstration/test fixtures, never by the running Studio.
export async function captureEnglishDocumentation(page, name, target = page) {
  if (!process.argv.includes('--docs-en')) return false;
  if (!/^desktop-[a-z-]+\.png$/.test(name)) throw new Error('Invalid documentation screenshot name');
  await mkdir(output, { recursive: true });
  const preference = await page.evaluate(async () => {
    const language = await import('/public/i18n.js');
    const previous = language.getLanguagePreference();
    language.setLanguage('en');
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return previous;
  });
  try {
    await target.screenshot({ path: resolve(output, name), animations: 'disabled' });
  } finally {
    await page.evaluate(async (previous) => {
      const language = await import('/public/i18n.js');
      language.setLanguage(previous);
    }, preference);
  }
  return true;
}
