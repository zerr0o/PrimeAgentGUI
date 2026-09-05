import {
  composerText,
  setComposerText,
  composerCommand,
  selectComposerCommand,
  createCommandChip,
} from './composer.js';
import { COMMAND_ALIASES as aliases, immediateCommands } from './command-definitions.js';
const node = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
const labels = {
  studio: 'Studio',
  native: 'Prime Agent',
  skill: 'Skill',
  prompt: 'Prompt',
  extension: 'Extension',
};
const normalize = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function commandTitle(command, tag = 'span') {
  const title = node(tag, 'command-title');
  const dot = node('span', 'command-dot');
  dot.dataset.kind = command.source;
  dot.setAttribute('aria-hidden', 'true');
  title.append(dot, document.createTextNode(`/${command.name}`));
  return title;
}

export function createCommands({ api, getContext, action, onChange, onError, hasAttachments }) {
  const input = document.getElementById('composer');
  const chip = createCommandChip();
  const button = node('button', 'attach-image-button command-launcher');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M15 4 9 20"/></svg>';
  button.id = 'open-commands';
  button.type = 'button';
  button.title = 'Commandes et skills';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'dialog');
  document.querySelector('.attachment-controls').prepend(button);
  const popup = node('div', 'command-suggestions');
  popup.id = 'command-suggestions';
  popup.hidden = true;
  popup.setAttribute('role', 'listbox');
  popup.setAttribute('aria-label', 'Commandes proposées');
  input.setAttribute('aria-controls', popup.id);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  const dialog = node('dialog', 'modal command-dialog');
  dialog.id = 'commands-dialog';
  dialog.setAttribute('aria-labelledby', 'commands-title');
  const header = node('div', 'command-heading');
  const title = node('h2', '', 'Commandes et skills');
  title.id = 'commands-title';
  const close = node('button', 'secondary-button', 'Terminé');
  close.type = 'button';
  close.onclick = () => dialog.close();
  header.append(title, close);
  const intro = node(
    'p',
    'command-intro',
    'Choisissez un raccourci, ajoutez vos consignes puis envoyez. Les skills et prompts sont développés par Prime Agent.',
  );
  const search = node('input', 'command-search');
  search.type = 'search';
  search.placeholder = 'Rechercher un nom ou une description';
  search.setAttribute('aria-label', 'Rechercher une commande ou un skill');
  const filters = node('div', 'command-filters');
  const filterButtons = new Map();
  const list = node('div', 'command-list');
  const more = node('button', 'command-more', 'Afficher la suite');
  more.type = 'button';
  more.hidden = true;
  const refresh = node('button', 'command-refresh', 'Actualiser');
  refresh.type = 'button';
  const note = node('p', 'command-note');
  note.setAttribute('role', 'status');
  const help = node('details', 'command-help');
  help.append(
    node('summary', '', 'Comment utiliser les skills ?'),
    node(
      'p',
      '',
      'Un skill regroupe des instructions et parfois des scripts. /skill:nom charge ses instructions dans votre message ; ajoutez votre demande après le nom. Prime Agent découvre les skills globaux, ceux du projet et ceux des packages installés. Les changements sont pris en compte par les nouvelles sessions ; une session active conserve ses ressources chargées. Les skills Python nécessitent leurs dépendances dans le Python du moteur.',
    ),
  );
  dialog.append(header, intro, search, filters, note, list, help);
  document.body.append(popup, dialog);
  const cache = new Map();
  let catalog = null,
    catalogKey = '',
    loadedAt = 0,
    pending,
    generation = 0,
    index = 0,
    matches = [],
    filter = 'all',
    dismissed = false,
    sending = false,
    loadError = '',
    prefetchKey = '',
    prefetchTimer,
    controller,
    pageSize = 30,
    currentList = [],
    suggestionQuery = '';
  const key = () => {
    const c = getContext();
    return `${c.cwd || ''}\0${c.sessionId || ''}\0${!!c.running}`;
  };
  function hide() {
    popup.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function update() {
    const context = getContext();
    chip.update();
    button.disabled = context.readOnly || !context.cwd || context.loading;
    if (catalogKey && catalogKey !== key()) {
      generation++;
      controller?.abort();
      catalog = null;
      pending = null;
      catalogKey = '';
      hide();
      if (dialog.open) dialog.close();
    }
    if (context.cwd && !context.readOnly && !context.loading && prefetchKey !== key()) {
      prefetchKey = key();
      clearTimeout(prefetchTimer);
      prefetchTimer = setTimeout(() => void load().catch(() => {}), 100);
    }
  }
  async function load({ force = false } = {}) {
    update();
    const cached = cache.get(key());
    if (!catalog && cached) {
      catalog = cached.data;
      loadedAt = cached.at;
      catalogKey = key();
    }
    if (!force && catalog && Date.now() - loadedAt < 30000) return catalog;
    if (pending) return pending;
    const c = getContext(),
      token = generation,
      requestedKey = key();
    if (!c.cwd) throw new Error('Choisissez un projet pour voir ses commandes.');
    catalogKey = requestedKey;
    controller = new AbortController();
    loadError = '';
    pending = api(
      `/api/commands?cwd=${encodeURIComponent(c.cwd)}${c.sessionId ? `&sessionId=${encodeURIComponent(c.sessionId)}` : ''}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (token !== generation || requestedKey !== key())
          throw new Error('Le projet sélectionné a changé.');
        catalog = data;
        loadedAt = Date.now();
        if (cache.size >= 12) cache.delete(cache.keys().next().value);
        cache.set(requestedKey, { data, at: loadedAt });
        return data;
      })
      .catch((error) => {
        if (token === generation && error.name !== 'AbortError') loadError = error.message;
        throw error;
      })
      .finally(() => {
        if (token === generation) {
          pending = null;
          if (dialog.open) renderList();
          if (!popup.hidden) renderSuggestions();
        }
      });
    return pending;
  }
  function insert(command) {
    if (!command.supported) return;
    const text = composerText();
    const suffix = composerCommand()
      ? input.value
      : text.startsWith('/')
        ? text.replace(/^\/\S*\s*/, '')
        : text;
    selectComposerCommand(command, suffix);
    hide();
    dialog.close();
    dismissed = true;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    onChange();
  }
  function available() {
    return catalog?.commands || cache.get(key())?.data.commands || immediateCommands;
  }
  function filtered(items, query) {
    const q = normalize(query).replace(/^\//, '');
    return items
      .filter((c) => normalize(`${c.name} ${c.description} ${c.sourceInfo?.scope || ''}`).includes(q))
      .sort(
        (a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || a.name.localeCompare(b.name),
      );
  }
  function renderList({ keepPage = false } = {}) {
    if (!keepPage) pageSize = 30;
    list.replaceChildren();
    const commands = available().filter((c) =>
      filter === 'terminal' ? !c.supported : c.supported && (filter === 'all' || c.source === filter),
    );
    const visible = filtered(commands, search.value);
    currentList = visible;
    note.textContent =
      loadError ||
      (pending
        ? 'Chargement des skills et prompts…'
        : catalog?.live
          ? 'Ressources chargées dans cette session.'
          : 'Ressources du projet pour les nouvelles sessions.');
    note.setAttribute('aria-busy', String(!!pending));
    if (catalog?.diagnostics?.length)
      note.textContent += ` ${catalog.diagnostics.map((d) => d.message).join(' · ')}`;
    for (const command of visible.slice(0, pageSize)) {
      const row = node('button', 'command-item');
      row.type = 'button';
      row.disabled = !command.supported;
      const name = node('span', 'command-name');
      name.append(commandTitle(command), node('small', '', command.argumentHint || labels[command.source]));
      row.append(name, node('span', 'command-description', command.description || labels[command.source]));
      if (command.sourceInfo?.path) {
        const path = node('span', 'command-source', command.sourceInfo.path);
        path.title = command.sourceInfo.path;
        row.append(path);
      }
      if (command.explicitOnly) row.append(node('span', 'command-source', 'Invocation explicite uniquement'));
      if (command.pythonPackage) row.append(node('span', 'command-source', 'Inclut un module Python'));
      if (!command.supported) row.append(node('span', 'command-source', command.reason));
      row.onclick = () => insert(command);
      list.append(row);
    }
    if (!visible.length && !pending)
      list.append(node('p', 'command-empty', 'Aucun résultat pour ce filtre.'));
    more.hidden = visible.length <= pageSize;
    more.textContent = `Afficher la suite · ${Math.min(pageSize, visible.length)} sur ${visible.length}`;
    list.append(more);
    for (const [value, b] of filterButtons) b.setAttribute('aria-pressed', String(value === filter));
  }
  more.onclick = () => {
    const top = list.scrollTop;
    const previousSize = pageSize,
      focused = document.activeElement === more;
    pageSize = Math.min(pageSize + 30, currentList.length);
    renderList({ keepPage: true });
    list.scrollTop = top;
    if (focused) list.querySelectorAll('.command-item')[previousSize]?.focus({ preventScroll: true });
  };
  if ('IntersectionObserver' in window)
    new IntersectionObserver(
      (entries) => {
        if (dialog.open && entries.some((entry) => entry.isIntersecting) && !more.hidden) more.click();
      },
      { root: list, rootMargin: '80px' },
    ).observe(more);
  refresh.onclick = () => {
    void load({ force: true }).catch(() => {});
    renderList();
  };
  for (const [value, label] of [
    ['all', 'Tout'],
    ['skill', 'Skills'],
    ['prompt', 'Prompts'],
    ['terminal', 'Terminal'],
  ]) {
    const b = node('button', '', label);
    b.type = 'button';
    b.onclick = () => {
      filter = value;
      renderList();
    };
    filters.append(b);
    filterButtons.set(value, b);
  }
  filters.append(refresh);
  async function open(selected = 'all') {
    update();
    hide();
    filter = selected;
    search.value = '';
    dialog.showModal();
    search.focus();
    void load().catch(() => {});
    renderList();
  }
  function position() {
    if (popup.hidden) return;
    const rect = document.getElementById('composer-form').getBoundingClientRect();
    const top = window.visualViewport?.offsetTop || 0;
    popup.style.left = `${Math.max(8, rect.left)}px`;
    popup.style.width = `${Math.min(rect.width, innerWidth - 16)}px`;
    popup.style.maxHeight = `${Math.max(70, Math.min(310, rect.top - top - 12))}px`;
    popup.style.bottom = `${innerHeight - rect.top + 6}px`;
  }
  async function suggest() {
    if (
      dismissed ||
      document.activeElement !== input ||
      composerCommand() ||
      !/^\/[^\s]*$/.test(input.value) ||
      getContext().readOnly
    ) {
      hide();
      return;
    }
    suggestionQuery = input.value;
    void load().catch(() => {});
    renderSuggestions();
  }
  function renderSuggestions() {
    if (
      suggestionQuery !== input.value ||
      composerCommand() ||
      dismissed ||
      document.activeElement !== input
    ) {
      hide();
      return;
    }
    const selected = matches[index]?.name;
    matches = filtered(
      available().filter((c) => c.supported),
      suggestionQuery,
    ).slice(0, 12);
    index = Math.max(
      0,
      matches.findIndex((command) => command.name === selected),
    );
    popup.replaceChildren();
    matches.forEach((c, i) => {
      const row = node('div', 'command-suggestion');
      row.id = `command-option-${i}`;
      row.setAttribute('role', 'option');
      row.append(commandTitle(c, 'strong'), node('span', '', c.description || labels[c.source]));
      row.onpointerdown = (event) => event.preventDefault();
      row.onclick = () => insert(c);
      popup.append(row);
    });
    if (pending || loadError || !matches.length) {
      const status = node(
        'p',
        'command-loading',
        loadError || (pending ? 'Chargement des skills et prompts…' : 'Aucune commande correspondante.'),
      );
      status.setAttribute('role', 'status');
      popup.append(status);
    }
    if (loadError) {
      const retry = node('button', 'command-more', 'Réessayer');
      retry.type = 'button';
      retry.onpointerdown = (e) => e.preventDefault();
      retry.onclick = () => {
        void load({ force: true }).catch(() => {});
        renderSuggestions();
      };
      popup.append(retry);
    }
    popup.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (matches.length) selectIndex();
    else input.removeAttribute('aria-activedescendant');
    position();
  }
  function selectIndex() {
    [...popup.querySelectorAll('[role=option]')].forEach((row, i) =>
      row.setAttribute('aria-selected', String(i === index)),
    );
    const row = document.getElementById(`command-option-${index}`);
    input.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
  }
  input.addEventListener(
    'keydown',
    (event) => {
      if (popup.hidden || event.isComposing) return;
      if (!matches.length && ['Tab', 'Enter'].includes(event.key)) {
        hide();
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'].includes(event.key)) {
        if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape') {
          dismissed = true;
          hide();
        } else if (event.key === 'Tab' || event.key === 'Enter') {
          if (matches[index]) insert(matches[index]);
        } else if (matches.length) {
          index = (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
          selectIndex();
        }
      }
    },
    true,
  );
  input.addEventListener('input', () => {
    dismissed = false;
    void suggest();
  });
  input.addEventListener('focus', () => {
    dismissed = false;
    void suggest();
  });
  input.addEventListener('blur', hide);
  window.addEventListener('resize', position);
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  button.onclick = () => void open();
  search.oninput = renderList;
  return {
    open,
    update,
    restoreDraft() {
      const text = composerText(),
        requestedKey = key();
      const match = text.match(/^\/([^\s/]+) ([\s\S]*)$/);
      if (!match) return;
      void load()
        .then((data) => {
          if (key() !== requestedKey || composerText() !== text || input.selectionStart < match[1].length + 2)
            return;
          const name = Object.hasOwn(aliases, match[1]) ? aliases[match[1]] : match[1];
          const command = data.commands.find((c) => c.name === name && c.supported);
          if (!command) return;
          const offset = match[1].length + 2,
            start = input.selectionStart - offset,
            end = input.selectionEnd - offset;
          selectComposerCommand({ ...command, name: match[1] }, match[2]);
          input.setSelectionRange(start, end);
          onChange();
        })
        .catch(() => {});
    },
    async intercept() {
      const draft = composerText();
      if (draft.trim() === '/') {
        void open();
        return true;
      }
      const parsed = draft.trim().match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
      if (!parsed) return false;
      if (sending || getContext().readOnly) return true;
      sending = true;
      const contextKey = key();
      try {
        const name = Object.hasOwn(aliases, parsed[1]) ? aliases[parsed[1]] : parsed[1],
          args = (parsed[2] || '').trim();
        const studio = immediateCommands.find((c) => c.name === name);
        const data = studio ? { commands: [studio] } : await load();
        if (composerText() !== draft || contextKey !== key()) return true;
        const command = data.commands.find((c) => c.name === name);
        if (!command)
          throw new Error(`Commande /${name} inconnue. Ouvrez le menu / pour voir les commandes du projet.`);
        if (!command.supported) throw new Error(command.reason);
        hide();
        if (command.source !== 'studio') return false;
        if (hasAttachments())
          throw new Error('Retirez les pièces jointes avant d’utiliser ce raccourci du Studio.');
        const token = composerCommand();
        setComposerText('');
        onChange();
        try {
          await action(command.action, args);
        } catch (error) {
          if (contextKey === key() && !composerText()) {
            if (token) selectComposerCommand(token, draft.slice(token.name.length + 2));
            else setComposerText(draft);
            onChange();
          }
          throw error;
        }
        return true;
      } catch (error) {
        onError(error);
        return true;
      } finally {
        sending = false;
      }
    },
  };
}
