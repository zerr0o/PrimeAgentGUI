// Shared by the browser and the gateway. One row owns every language variant.
import { languages, messages, fallbackLanguage } from './translations.js';

export { languages, messages, fallbackLanguage };
export function resolveLanguage(preference, requested = []) {
  const supported = new Set(languages.map((language) => language.id));
  const candidates = preference && preference !== 'auto' ? [preference] : requested;
  for (const candidate of candidates) {
    const language = String(candidate).toLowerCase().split(/[-_;]/)[0];
    if (supported.has(language)) return language;
  }
  return fallbackLanguage;
}
export function requestLanguage(headers = {}, explicit) {
  const cookie = String(headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('prime_studio_language='))
    ?.split('=')[1];
  const requested = String(headers['accept-language'] || '')
    .split(',')
    .map((part) => {
      const [id, quality] = part.trim().split(';q=');
      return { id, quality: quality === undefined ? 1 : Number(quality) };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.id);
  return resolveLanguage(explicit || cookie, requested);
}
export function formatMessage(key, params = {}, language = fallbackLanguage, table = messages) {
  const row = table[key];
  const valid = (value) =>
    typeof value === 'string'
      ? !!value.trim()
      : value && typeof value.other === 'string' && !!value.other.trim();
  const effectiveLanguage = valid(row?.[language]) ? language : fallbackLanguage;
  const translation = row?.[effectiveLanguage];
  if (!valid(translation)) return key;
  const plural = typeof translation === 'object';
  const form = plural ? new Intl.PluralRules(effectiveLanguage).select(Number(params.count) || 0) : '';
  const template = plural
    ? typeof translation[form] === 'string' && translation[form].trim()
      ? translation[form]
      : translation.other
    : translation;
  return template.replace(/\{([a-zA-Z][\w]*)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name] ?? '') : match,
  );
}

// Only call for Studio-owned API labels/errors; never for conversation or file contents.
const sourceKeys = new Map(
  Object.entries(messages).flatMap(([key, row]) =>
    Object.values(row)
      .filter((value) => typeof value === 'string')
      .map((value) => [value, key]),
  ),
);
export const messageKey = (text) => sourceKeys.get(text);
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.entries(messages)
  .flatMap(([key, row]) => [...new Set(Object.values(row))].map((text) => ({ key, text })))
  .flatMap(({ key, text }) => {
    if (typeof text !== 'string' || !/\{\w+\}/.test(text)) return [];
    const names = [];
    let last = 0,
      source = '^';
    for (const match of text.matchAll(/\{([a-zA-Z][\w]*)\}/g)) {
      source += escapePattern(text.slice(last, match.index)) + '([\\s\\S]*?)';
      names.push(match[1]);
      last = match.index + match[0].length;
    }
    source += escapePattern(text.slice(last)) + '$';
    return [{ key, names, regex: new RegExp(source), specificity: text.replace(/\{\w+\}/g, '').length }];
  })
  .filter((entry) => entry.specificity >= 8)
  .sort((a, b) => b.specificity - a.specificity);
export function knownMessage(text, language = fallbackLanguage) {
  if (typeof text !== 'string') return text;
  const key = sourceKeys.get(text);
  if (key) return formatMessage(key, {}, language);
  if (text.length > 16000) return text;
  for (const entry of templates) {
    const match = entry.regex.exec(text);
    if (match)
      return formatMessage(
        entry.key,
        Object.fromEntries(entry.names.map((name, i) => [name, match[i + 1]])),
        language,
      );
  }
  return text;
}
