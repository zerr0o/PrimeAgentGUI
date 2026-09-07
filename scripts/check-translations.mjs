import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { languages, messages, fallbackLanguage } from '../public/translations.js';

const placeholders = (text) =>
  [...new Set([...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((match) => match[1]))].sort().join(',');
const forms = (value) =>
  typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value) : [];
export function validateTranslations(table = messages, supported = languages, fallback = fallbackLanguage) {
  const errors = [],
    ids = supported.map((entry) => entry.id);
  if (!ids.includes(fallback)) errors.push('The fallback language must be registered.');
  if (new Set(ids).size !== ids.length) errors.push('Duplicate language identifiers.');
  for (const entry of supported) {
    if (!/^[a-z]{2,3}$/.test(entry.id) || !entry.label?.trim()) errors.push(`Invalid language: ${entry.id}`);
  }
  for (const [key, row] of Object.entries(table)) {
    if (!/^[a-z][\w.-]+$/.test(key)) errors.push(`Invalid message key: ${key}`);
    const source = forms(row?.[fallback]);
    const expected = placeholders(source.join(' '));
    for (const language of ids) {
      const value = row?.[language],
        variants = forms(value);
      if (!variants.length || variants.some((text) => typeof text !== 'string' || !text.trim())) {
        errors.push(`${key}: missing ${language} translation`);
        continue;
      }
      if (typeof value === 'object' && (typeof value.other !== 'string' || !value.other.trim()))
        errors.push(`${key}: missing ${language}.other plural`);
      if (typeof value !== typeof row[fallback])
        errors.push(`${key}: inconsistent plural type for ${language}`);
      if (placeholders(variants.join(' ')) !== expected)
        errors.push(`${key}: mismatched ${language} parameters`);
    }
    for (const language of Object.keys(row))
      if (!ids.includes(language)) errors.push(`${key}: unregistered language ${language}`);
  }
  return errors;
}

export async function validateTranslationReferences() {
  const errors = [];
  const files = [
    'index.html',
    'server.mjs',
    ...(await Promise.all(
      ['public', 'lib'].map(async (dir) =>
        (await readdir(dir))
          .filter(
            (file) =>
              /\.(?:m?js|html)$/.test(file) && !['translations.js', 'i18n-core.js', 'i18n.js'].includes(file),
          )
          .map((file) => dir + '/' + file),
      ),
    )),
  ].flat();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(
      /(?:\btr\(\s*|\bt\(\s*|data-i18n(?:-[\w-]+)?=)[\\]*["']([\w.-]+)[\\]*["']/g,
    )) {
      if (!(match[1] in messages)) errors.push(`${file}: unknown message ${match[1]}`);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = [...validateTranslations(), ...(await validateTranslationReferences())];
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      `${Object.keys(messages).length} messages verified in ${languages.map((language) => language.id).join(' / ')}.`,
    );
}
