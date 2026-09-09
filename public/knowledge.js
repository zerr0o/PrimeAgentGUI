import { t, getLanguage, onLanguageChange } from './i18n.js';
import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const kinds = ['all', 'history', 'memory', 'refinement'];

export function createKnowledgeBrowser({ api, onOpenSession }) {
  const stylesheet = node('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/public/knowledge.css';
  document.head.append(stylesheet);
  const dialog = node('dialog', 'modal knowledge-dialog');
  dialog.id = 'knowledge-dialog';
  dialog.setAttribute('aria-labelledby', 'knowledge-title');
  dialog.innerHTML = `
    <header class="knowledge-heading">
      <div><h2 id="knowledge-title"></h2><p id="knowledge-project"></p></div>
      <button type="button" class="icon-button knowledge-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
    </header>
    <div class="knowledge-controls">
      <label class="knowledge-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/></svg><input type="search" maxlength="500" autocomplete="off" spellcheck="false"/></label>
      <div class="knowledge-filters" role="group"></div>
    </div>
    <div class="knowledge-content">
      <section class="knowledge-results"><p class="knowledge-status" role="status" aria-live="polite"></p><div class="knowledge-list"></div><button type="button" class="text-button knowledge-more" hidden></button></section>
      <section class="knowledge-detail" aria-label="Source"><div class="knowledge-detail-content"></div></section>
    </div>
    <footer class="knowledge-footer"></footer>`;
  document.body.append(dialog);
  const $ = (selector) => dialog.querySelector(selector);
  const input = $('input');
  const list = $('.knowledge-list');
  const status = $('.knowledge-status');
  const detail = $('.knowledge-detail-content');
  let project,
    kind = 'all',
    items = [],
    selected = null,
    currentDetail = null,
    nextCursor = null;
  let searchController, detailController, timer, lastFocus, lastFocusKey;
  const dateText = (date) => {
    if (!date || Number.isNaN(new Date(date).valueOf())) return '';
    return new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'medium' }).format(new Date(date));
  };
  const metadata = (item) =>
    [
      t(`knowledge.kind.${item.kind}`),
      t(`knowledge.scope.${item.scope === 'global' ? 'global' : 'session'}`),
      dateText(item.date),
    ]
      .filter(Boolean)
      .join(' · ');
  const button = (key, className, handler) => {
    const element = node('button', className, t(key));
    element.type = 'button';
    element.onclick = handler;
    return element;
  };
  function translate() {
    $('#knowledge-title').textContent = t('knowledge.open');
    $('.knowledge-close').setAttribute('aria-label', t('knowledge.close'));
    input.placeholder = t('knowledge.search');
    input.setAttribute('aria-label', t('knowledge.search'));
    $('.knowledge-filters').setAttribute('aria-label', t('knowledge.filter'));
    $('.knowledge-detail').setAttribute('aria-label', t('knowledge.source'));
    $('.knowledge-footer').textContent = t('knowledge.native');
    $('.knowledge-more').textContent = t('knowledge.more');
    renderFilters();
    renderList();
    if (currentDetail) renderDetail(currentDetail);
    else if (!selected) detail.textContent = t('knowledge.choose');
  }
  function renderFilters() {
    const focusedKind = $('.knowledge-filters').contains(document.activeElement)
      ? document.activeElement.dataset.kind
      : null;
    $('.knowledge-filters').replaceChildren(
      ...kinds.map((value) => {
        const b = button(`knowledge.kind.${value}`, 'knowledge-filter', () => {
          kind = value;
          renderFilters();
          void search();
        });
        b.dataset.kind = value;
        b.setAttribute('aria-pressed', String(kind === value));
        return b;
      }),
    );
    if (focusedKind)
      [...$('.knowledge-filters').children]
        .find((b) => b.dataset.kind === focusedKind)
        ?.focus({ preventScroll: true });
  }
  function renderList() {
    const focusedId = list.contains(document.activeElement)
      ? document.activeElement.dataset.knowledgeId
      : null;
    list.replaceChildren(
      ...items.map((item) => {
        const b = node('button', 'knowledge-result');
        b.type = 'button';
        b.dataset.knowledgeId = item.id;
        b.setAttribute('aria-current', String(selected === item.id));
        b.append(
          node('span', 'knowledge-result-title', item.title || t(`knowledge.kind.${item.kind}`)),
          node('span', 'knowledge-result-meta', metadata(item)),
          node('span', 'knowledge-result-excerpt', item.excerpt || ''),
        );
        b.onclick = () => {
          dialog.classList.add('knowledge-show-detail');
          void select(item.id, true);
        };
        return b;
      }),
    );
    if (focusedId)
      [...list.children].find((b) => b.dataset.knowledgeId === focusedId)?.focus({ preventScroll: true });
  }
  function renderMarkdown(target, text) {
    // A native source may contain arbitrary HTML. Permit prose formatting only,
    // before inserting it, so it cannot style the app or load embedded resources.
    target.innerHTML = DOMPurify.sanitize(marked.parse(String(text || ''), { async: false }), {
      ALLOWED_TAGS: [
        'p',
        'br',
        'hr',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'blockquote',
        'pre',
        'code',
        'em',
        'strong',
        'b',
        'i',
        'del',
        's',
        'a',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'th',
        'td',
        'div',
        'span',
        'kbd',
        'samp',
        'details',
        'summary',
      ],
      ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'start'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
    for (const a of target.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) a.removeAttribute('href');
      else {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    }
  }
  function backButton() {
    return button('knowledge.back', 'text-button knowledge-back', () => {
      detailController?.abort();
      $('.knowledge-detail').removeAttribute('aria-busy');
      dialog.classList.remove('knowledge-show-detail');
      [...list.children].find((b) => b.dataset.knowledgeId === selected)?.focus();
    });
  }
  function focusMobileDetail(enabled) {
    if (enabled && matchMedia('(max-width: 760px)').matches)
      $('.knowledge-back').focus({ preventScroll: true });
  }
  function renderDetail(item) {
    detail.replaceChildren();
    detail.append(
      backButton(),
      node('p', 'knowledge-detail-meta', metadata(item)),
      node('h3', '', item.title || t(`knowledge.kind.${item.kind}`)),
    );
    if (item.sessionTitle) detail.append(node('p', 'knowledge-session-name', item.sessionTitle));
    const body = node('div', 'knowledge-body');
    let bodyText = item.body || item.content || item.excerpt || '';
    if (item.kind === 'refinement' && bodyText.startsWith(`${item.title}\n\n`))
      bodyText = bodyText.slice(item.title.length + 2);
    renderMarkdown(body, bodyText);
    detail.append(body);
    if (item.truncated) detail.append(node('p', 'knowledge-warning', t('knowledge.truncated')));
    if (item.changes?.length) {
      const changes = node('div', 'knowledge-changes');
      changes.append(node('h4', '', t('knowledge.changes')));
      for (const change of item.changes) {
        const row = node('section', 'knowledge-change');
        row.append(node('h5', '', change.after?.title || change.before?.title || change.id || change.kind));
        if (change.applied === false)
          row.append(node('p', 'knowledge-not-applied', t('knowledge.not_applied')));
        const pair = node('div', 'knowledge-change-pair');
        for (const side of ['before', 'after']) {
          const pane = node('div');
          pane.append(node('span', 'knowledge-change-label', t(`knowledge.${side}`)));
          const content = node('div', 'knowledge-body');
          renderMarkdown(
            content,
            change[side]?.content ??
              change[side]?.text ??
              (change[side] ? JSON.stringify(change[side], null, 2) : t('knowledge.absent')),
          );
          pane.append(content);
          pair.append(pane);
        }
        row.append(pair);
        changes.append(row);
      }
      detail.append(changes);
    }
    const source = node('details', 'knowledge-source');
    source.append(node('summary', '', t('knowledge.source')));
    const sourceValue = typeof item.source === 'string' ? { path: item.source } : item.source || {};
    const location = [
      sourceValue.path,
      sourceValue.line ? t('knowledge.line', { line: sourceValue.line }) : '',
      sourceValue.pointer,
    ]
      .filter(Boolean)
      .join('\n');
    source.append(node('pre', '', location));
    if (sourceValue.messageId)
      source.append(node('p', '', `${t('knowledge.message')} ${sourceValue.messageId}`));
    detail.append(source);
    if (item.sessionId && item.sessionOpenable !== false) {
      detail.append(
        button('knowledge.open_session', 'secondary-button knowledge-open-session', async () => {
          lastFocus = lastFocusKey = null;
          dialog.close();
          await onOpenSession?.({
            sessionId: item.sessionId,
            cwd: project.cwd,
            messageId: sourceValue.messageId,
          });
        }),
      );
    }
  }
  async function select(id, focusDetail = false) {
    detailController?.abort();
    const controller = (detailController = new AbortController());
    selected = id;
    currentDetail = null;
    renderList();
    detail.replaceChildren(backButton(), node('p', '', t('knowledge.loading')));
    focusMobileDetail(focusDetail);
    $('.knowledge-detail').setAttribute('aria-busy', 'true');
    try {
      const item = await api(`/api/knowledge/item?${new URLSearchParams({ cwd: project.cwd, id })}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      currentDetail = item;
      renderDetail(item);
      $('.knowledge-detail').scrollTop = 0;
      focusMobileDetail(focusDetail);
    } catch (error) {
      if (controller.signal.aborted) return;
      detail.replaceChildren(
        backButton(),
        node('p', 'knowledge-error', error.message),
        button('knowledge.retry', 'text-button', () => void select(id, true)),
      );
      focusMobileDetail(focusDetail);
    } finally {
      if (!controller.signal.aborted) $('.knowledge-detail').removeAttribute('aria-busy');
    }
  }
  async function search(append = false) {
    clearTimeout(timer);
    searchController?.abort();
    const controller = (searchController = new AbortController());
    if (!append) {
      detailController?.abort();
      $('.knowledge-detail').removeAttribute('aria-busy');
      selected = currentDetail = null;
      dialog.classList.remove('knowledge-show-detail');
      detail.textContent = t('knowledge.choose');
      items = [];
      renderList();
    }
    status.textContent = t('knowledge.loading');
    $('.knowledge-results').setAttribute('aria-busy', 'true');
    $('.knowledge-more').hidden = true;
    try {
      const params = new URLSearchParams({ cwd: project.cwd, q: input.value.trim(), kind, limit: '30' });
      if (append && nextCursor) params.set('cursor', nextCursor);
      const result = await api(`/api/knowledge?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      items = append ? [...items, ...result.items] : result.items;
      nextCursor = result.nextCursor || null;
      status.textContent = items.length
        ? t('knowledge.results', { count: result.total ?? items.length })
        : t(input.value.trim() ? 'knowledge.no_results' : 'knowledge.empty');
      if (result.warnings?.length) status.append(node('span', 'knowledge-warning', t('knowledge.partial')));
      renderList();
      $('.knowledge-more').hidden = !nextCursor;
      if (!append && items.length && matchMedia('(min-width: 761px)').matches) void select(items[0].id);
    } catch (error) {
      if (controller.signal.aborted) return;
      status.replaceChildren(
        node('span', 'knowledge-error', error.message),
        button('knowledge.retry', 'text-button', () => void search(append)),
      );
    } finally {
      if (!controller.signal.aborted) $('.knowledge-results').removeAttribute('aria-busy');
    }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    // Cancel stale requests immediately; debounce only the next request.
    searchController?.abort();
    detailController?.abort();
    timer = setTimeout(() => void search(), 220);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void search();
    }
  });
  $('.knowledge-close').onclick = () => dialog.close();
  $('.knowledge-more').onclick = () => void search(true);
  dialog.addEventListener('close', () => {
    clearTimeout(timer);
    searchController?.abort();
    detailController?.abort();
    const restore = lastFocus?.isConnected
      ? lastFocus
      : lastFocusKey
        ? [...document.querySelectorAll('[data-navigation-key]')].find(
            (element) => element.dataset.navigationKey === lastFocusKey,
          )
        : null;
    if (restore?.getClientRects().length) restore.focus({ preventScroll: true });
  });
  onLanguageChange(() => {
    if (dialog.open) {
      translate();
      void search();
    }
  });
  translate();
  return {
    open(value, trigger = document.activeElement) {
      project = value;
      lastFocus = trigger;
      lastFocusKey = trigger?.dataset.navigationKey;
      kind = 'all';
      input.value = '';
      $('#knowledge-project').textContent = value.name || value.cwd.split(/[\\/]/).filter(Boolean).at(-1);
      translate();
      if (!dialog.open) dialog.showModal();
      input.focus();
      void search();
    },
  };
}
