# Languages and translations

**English** · [Français](../translations.md) · [← Back to README](../../README.md)

Studio offers French and English on desktop, mobile and in the PWA. **Preferences → Appearance → Language** changes the interface immediately. The choice is saved per browser and access address; tabs at the same address synchronize. Sessions and input continue without reloading.

## One table

All languages sit side by side in [`public/translations.js`](../../public/translations.js), including interface text returned by the server. There is no independent file to synchronize for each language.

```js
export const fallbackLanguage = 'fr';
export const languages = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
];

export const messages = {
  'language.label': { fr: 'Langue', en: 'Language' },
  'common.editName': { fr: 'Modifier {value1}', en: 'Edit {value1}' },
  'count.tools': {
    fr: { one: '{count} appel d’outil', other: '{count} appels d’outil' },
    en: { one: '{count} tool call', other: '{count} tool calls' },
  },
};
```

Identifiers are stable: correcting wording does not require renaming its key. Parameters have the same names in every language and can be reordered. For new text, prefer explicit names such as `{name}` or `{count}`. Some migrated messages use `{value1}`, `{value2}`, etc.

Plurals follow the displayed language’s `Intl.PluralRules`. A plural entry must include an `other` form; languages that need them can add `zero`, `two`, `few` and `many`. Dates and numbers also use the selected language.

## Fallback and validation

If a translation is missing or empty, Studio uses **French from the same row**. Unsupported languages also fall back to French. Fallback works online and offline. Unknown keys are rendered as identifiers so they can be noticed during development, and are rejected by checks before publication.

```powershell
npm run check:translations
node --test test/i18n.test.mjs
npm run test:i18n
```

The first command, also included in `npm run check`, checks missing entries, parameters, plural forms, and code and HTML references. Fallback is a runtime safeguard; it does not remove the need to complete a language before publication.

## Add a language

1. Add its code and name to `languages` in the same file.
2. Add its translation to every `messages` row. Preserve all parameters and the `other` plural form.
3. Run checks, then review desktop and mobile screens in that language, especially buttons, forms and small screens.

Selectors populate from `languages`: no component needs another hardcoded list. The current system covers left-to-right interfaces; a right-to-left language would also require layout adaptations.

## Use a translation

For static text in HTML:

```html
<button data-i18n="ui.fermer">Fermer</button>
<input data-i18n-placeholder="ui.rechercher_une_session" placeholder="Rechercher une session" />
```

Markers also exist for `title`, `aria-label`, `data-prompt` and `content`. French text in HTML provides a usable initial display; the table remains authoritative.

For dynamic text:

```js
import { t, bindText, bindAttribute } from './i18n.js';

bindText(counter, () => t('count.tools', { count: tools.length }));
bindAttribute(button, 'aria-label', () => t('common.editName', { value1: project.name }));
```

Rendering functions reevaluate their text when the language changes. `bindText` retains the text node it created: inputs or icons subsequently added to the same element are not removed. Detached nodes are weakly referenced, and cached views refresh when reinserted.

Use a complete sentence with parameters, not concatenated grammatical fragments. Translations are inserted as **text**, never executable HTML. The code observes only explicit markers and interface bindings; it does not scan conversations for words to replace.

The server uses `formatMessage` with reference French to preserve the history and diagnostic contract. `translateKnown` is reserved for Studio-owned interface messages received through the API. Do not apply it to conversations, files, project names or instructions from external resources.

Commands such as `/goal`, model identifiers, paths and protocol values remain unchanged. Interface language does not change the system prompt or the language requested from an agent. Home-screen starter suggestions are translated before insertion; an existing draft keeps its text.

## Maintain bilingual documentation

The English README is `README.md`, with French in `README.fr.md`. French guides retain their `docs/*.md` addresses, and English guides live in `docs/en/*.md`. Each page links to its counterpart. Links between guides stay in the selected language; commands, real filenames and code references are preserved.

[`docs/documentation.json`](../documentation.json) is the single registry of page pairs and their fingerprints after review. `npm run check:docs`, also included in `npm run check`, checks missing or unregistered pages, language navigation, local links, images, anchors and heading structure. If a page has changed since both versions were last reviewed, the check identifies the pair to revisit.

After editing a page, update or review its counterpart, then explicitly record the reviewed pairs by their identifiers:

```powershell
npm run docs:sync -- readme configuration
npm run check:docs
```

This command records a review; it does not translate text or certify translation quality. It must not be used to dismiss an outdated version. Fingerprints detect changes, including edits to only one language, but human review is still required to check meaning.

For a new guide, add both files, their language links and a registry entry, then review both versions before recording the pair. Application and documentation language choices are independent: GitHub uses page links without JavaScript or automatic translation.
