import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage, resolveLanguage, requestLanguage, knownMessage } from '../public/i18n-core.js';
import { validateTranslations, validateTranslationReferences } from '../scripts/check-translations.mjs';

test('the single translation table is complete and all source references exist', async () => {
  assert.deepEqual(validateTranslations(), []);
  assert.deepEqual(await validateTranslationReferences(), []);
});
test('locale selection respects explicit preference, browser order and a French fallback', () => {
  assert.equal(resolveLanguage('en', ['fr-FR']), 'en');
  assert.equal(resolveLanguage('auto', ['de-DE', 'en-GB', 'fr']), 'en');
  assert.equal(resolveLanguage('auto', ['fr-CA', 'en']), 'fr');
  assert.equal(resolveLanguage('missing', ['en']), 'fr');
  assert.equal(resolveLanguage('auto', ['ja']), 'fr');
  assert.equal(requestLanguage({ 'accept-language': 'fr;q=0.1,en-US;q=0.9' }), 'en');
  assert.equal(requestLanguage({ cookie: 'prime_studio_language=fr', 'accept-language': 'en-US' }), 'fr');
  assert.equal(
    requestLanguage({ cookie: 'prime_studio_language=auto', 'accept-language': 'fr;q=0,en;q=1' }),
    'en',
  );
});
test('missing or empty translations fall back to French including French plural rules', () => {
  const table = {
    greeting: { fr: 'Bonjour {name}' },
    empty: { fr: 'Fermer', en: '  ' },
    count: { fr: { one: '{count} élément', other: '{count} éléments' }, en: '' },
    emptyPlural: { fr: { one: '{count} élément', other: '{count} éléments' }, en: { other: ' ' } },
    emptySingular: { fr: { other: '{count} éléments' }, en: { one: ' ', other: '{count} items' } },
  };
  assert.equal(formatMessage('greeting', { name: '<Ada>' }, 'en', table), 'Bonjour <Ada>');
  assert.equal(formatMessage('empty', {}, 'en', table), 'Fermer');
  assert.equal(formatMessage('count', { count: 0 }, 'en', table), '0 élément');
  assert.equal(formatMessage('emptyPlural', { count: 0 }, 'en', table), '0 élément');
  assert.equal(formatMessage('emptySingular', { count: 1 }, 'en', table), '1 items');
  assert.equal(formatMessage('greeting', { name: 'Ada' }, 'unsupported!', table), 'Bonjour Ada');
  assert.equal(formatMessage('unknown', {}, 'en', table), 'unknown');
});
test('plural forms and placeholders work without translating user-provided values', () => {
  assert.equal(formatMessage('count.tools', { count: 1 }, 'en'), '1 tool call');
  assert.equal(formatMessage('count.tools', { count: 2 }, 'en'), '2 tool calls');
  assert.equal(formatMessage('count.models', { count: 3 }, 'en'), '3 configured models');
  assert.equal(formatMessage('common.editName', { value1: 'Fermer <script>' }, 'en'), 'Edit Fermer <script>');
  assert.equal(
    knownMessage('The provider returned its original diagnostic', 'fr'),
    'The provider returned its original diagnostic',
  );
  assert.equal(knownMessage('La demande JSON est invalide.', 'en'), 'The JSON request is invalid.');
  assert.equal(
    knownMessage('Le fichier dépasse la limite de 12 Mo.', 'en'),
    'The file exceeds the 12 MB limit.',
  );
  assert.equal(
    knownMessage('The file exceeds the 12 MB limit.', 'fr'),
    'Le fichier dépasse la limite de 12 Mo.',
  );
});
test('validation catches missing cells, parameters and invalid plural definitions', () => {
  const errors = validateTranslations({
    missing: { fr: 'Bonjour' },
    params: { fr: 'Bonjour {name}', en: 'Hello {other}' },
    plural: { fr: { one: '{count} test', other: '{count} tests' }, en: { one: '{count} test' } },
  });
  assert.ok(errors.some((error) => error.includes('missing en')));
  assert.ok(errors.some((error) => error.includes('mismatched en parameters')));
  assert.ok(errors.some((error) => error.includes('missing en.other')));
});
