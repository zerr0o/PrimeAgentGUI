import { t as tr, bindAttribute } from './i18n.js';
// Only explicit file references are linked. Plain prose and code blocks stay unchanged.
export function isFileReference(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value)) return false;
  const path = value.trim();
  if (!path || path.startsWith('#') || /^\/\//.test(path)) return false;
  if (/^[a-z][\w+.-]*:/i.test(path) && !/^(?:file:|[a-z]:[\\/])/i.test(path)) return false;
  return /\.(?:md|markdown|mdown|mkd|txt|pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|tsv|jsonl?|ya?ml|toml|ini|log|xml|html?|svg|png|jpe?g|gif|webp|js|jsx|mjs|cjs|ts|tsx|py|cs|cpp|hpp|h|c|rs|go|java|css|scss|sql|sh|ps1)(?:(?::\d+(?::\d+)?)|(?:#L?\d+(?:[-:]L?\d+)?))?$/i.test(
    path,
  );
}

export function fileLinkRenderer(marked, references) {
  const renderer = new marked.Renderer();
  const original = renderer.link;
  renderer.link = function (token) {
    if (!isFileReference(token.href)) return original.call(this, token);
    const id = references.push(token.href) - 1;
    return `<a href="#studio-file-${id}" data-studio-file="${id}">${this.parser.parseInline(token.tokens)}</a>`;
  };
  return renderer;
}

export function bindFileLinks(root, references, open) {
  function bind(anchor, reference) {
    anchor.classList.add('document-link');
    anchor.href = '#document';
    anchor.removeAttribute('target');
    bindAttribute(anchor, 'title', () => tr('ui.apercu_du_fichier', { value1: reference }));
    anchor.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void open(reference);
    };
  }
  root.querySelectorAll('a').forEach((anchor) => {
    const id = anchor.getAttribute('data-studio-file');
    const reference = id !== null && /^\d+$/.test(id) ? references[Number(id)] : anchor.getAttribute('href');
    anchor.removeAttribute('data-studio-file');
    if (isFileReference(reference)) bind(anchor, reference);
  });
  root.querySelectorAll('code').forEach((code) => {
    if (code.closest('pre, a') || !isFileReference(code.textContent)) return;
    const anchor = document.createElement('a');
    bind(anchor, code.textContent.trim());
    code.replaceWith(anchor);
    anchor.append(code);
  });
}
