import { languages, resolveLanguage, formatMessage, knownMessage } from './i18n-core.js';
export { languages };
const STORAGE_KEY = 'prime-studio.language';
let preference = 'auto';
try {
  preference = globalThis.localStorage?.getItem(STORAGE_KEY) || 'auto';
} catch {}
let language = resolveLanguage(preference, globalThis.document ? globalThis.navigator?.languages || [] : []);
let revision = 0;
const listeners = new Set();
const bindings = new Set();
const bound = new WeakMap();
const references = new WeakMap();
const collected = new FinalizationRegistry((reference) => bindings.delete(reference));
export const getLanguage = () => language;
export const getLanguagePreference = () => preference;
export const t = (key, params) => formatMessage(key, params, language);
export const translateKnown = (text) =>
  knownMessage(typeof text === 'function' ? evaluate(text) : text, language);
export const onLanguageChange = (callback) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
const evaluate = (value) => (typeof value === 'function' ? evaluate(value()) : (value ?? ''));

function bind(node, slot, value, apply) {
  const map = bound.get(node) || new Map();
  bound.set(node, map);
  if (!references.has(node)) {
    const reference = new WeakRef(node);
    references.set(node, reference);
    bindings.add(reference);
    collected.register(node, reference);
  }
  const binding = { value, apply, revision };
  map.set(slot, binding);
  apply(node, String(evaluate(value)));
  return node;
}
export function bindText(node, value) {
  // Own only this text node: labels often receive a form control or an icon afterward.
  // A language change must never replace those children or discard their state.
  const text = String(evaluate(value));
  if (node.nodeType === 3)
    return bind(node, 'text', value, (element, next) => {
      element.data = next;
    });
  const anchor =
    node.childNodes.length === 1 && node.firstChild.nodeType === 3
      ? node.firstChild
      : document.createTextNode(text);
  if (anchor.parentNode !== node) node.replaceChildren(anchor);
  return bind(node, 'text', value, (element, next) => {
    if (anchor.parentNode === element && anchor.data !== next) anchor.data = next;
  });
}
export const bindAttribute = (node, name, value) =>
  bind(node, name, value, (element, text) => {
    if (element.nodeType === 9 && name === 'title') {
      element.title = text;
      return;
    }
    if (element.getAttribute(name) !== text) element.setAttribute(name, text);
  });
export function textNode(value) {
  return bindText(document.createTextNode(''), value);
}
export function translatedOption(value, id = '', selected = false, active = false) {
  const option = new Option('', id, selected, active);
  return bindText(option, value);
}

export function translateDOM(root = document) {
  const apply = (node) => {
    if (node.closest('[data-i18n-ignore]')) return;
    if (node.dataset.i18n && !bound.get(node)?.has('text')) bindText(node, () => t(node.dataset.i18n));
    for (const name of ['title', 'placeholder', 'aria-label', 'data-prompt', 'content']) {
      const key = node.getAttribute('data-i18n-' + name);
      if (key && !bound.get(node)?.has(name)) bindAttribute(node, name, () => t(key));
    }
  };
  if (root.nodeType === 1) apply(root);
  root
    .querySelectorAll?.(
      '[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label], [data-i18n-data-prompt], [data-i18n-content]',
    )
    .forEach(apply);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let node = root;
  do {
    if (!node.isConnected) continue;
    for (const binding of bound.get(node)?.values() || [])
      if (binding.revision !== revision) {
        binding.apply(node, String(evaluate(binding.value)));
        binding.revision = revision;
      }
  } while ((node = walker.nextNode()));
}
export function setLanguage(value, { persist = true } = {}) {
  preference = value === 'auto' || languages.some((entry) => entry.id === value) ? value : 'auto';
  const next = resolveLanguage(preference, globalThis.navigator?.languages || []);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {}
  }
  if (next !== language) {
    language = next;
    revision++;
    if (globalThis.document) document.documentElement.lang = language;
    for (const reference of bindings) {
      const node = reference.deref();
      if (!node) {
        bindings.delete(reference);
        continue;
      }
      if (!node.isConnected && node.nodeType !== 9) continue;
      for (const binding of bound.get(node)?.values() || []) {
        binding.apply(node, String(evaluate(binding.value)));
        binding.revision = revision;
      }
    }
    listeners.forEach((callback) => callback(language));
  }
  syncLanguageMetadata();
  globalThis.document?.querySelectorAll('[data-language-select]').forEach((select) => {
    select.value = preference;
  });
}
function syncLanguageMetadata() {
  if (!globalThis.document) return;
  try {
    document.cookie = `prime_studio_language=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch {}
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.href = '/manifest.webmanifest?lang=' + language;
}
function initializeSelectors(root = document) {
  root.querySelectorAll('[data-language-select]').forEach((select) => {
    if (!select.options.length)
      select.append(
        translatedOption(() => t('language.auto'), 'auto'),
        ...languages.map((entry) => new Option(entry.label, entry.id)),
      );
    select.value = preference;
  });
}
if (globalThis.document) {
  document.documentElement.lang = language;
  syncLanguageMetadata();
  translateDOM();
  initializeSelectors();
  // Observe explicit translation markers only. Messages, code and user input are never scanned.
  const observer = new MutationObserver((changes) => {
    for (const change of changes)
      for (const node of change.addedNodes) if (node.nodeType === 1) translateDOM(node);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-language-select]')) setLanguage(event.target.value);
  });
  document.addEventListener('DOMContentLoaded', () => {
    translateDOM();
    initializeSelectors();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null)
      setLanguage(event.newValue || 'auto', { persist: false });
  });
  window.addEventListener('languagechange', () => {
    if (preference === 'auto') setLanguage('auto', { persist: false });
  });
}
