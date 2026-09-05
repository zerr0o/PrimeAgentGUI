const node = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
const aliases = { clear: 'new', usage: 'context', thinking: 'effort', rename: 'name' };
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

export function createCommands({ api, getContext, action, onChange, onError, hasAttachments }) {
  const input = document.getElementById('composer');
  const button = node('button', 'attach-image-button command-launcher', '/');
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
  let catalog = null,
    catalogKey = '',
    loadedAt = 0,
    pending,
    generation = 0,
    index = 0,
    matches = [],
    filter = 'all',
    dismissed = false,
    sending = false;
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
    button.disabled = context.readOnly || !context.cwd || context.loading;
    if (catalogKey && catalogKey !== key()) {
      generation++;
      catalog = null;
      pending = null;
      catalogKey = '';
      hide();
      if (dialog.open) dialog.close();
    }
  }
  async function load() {
    update();
    if (catalog && Date.now() - loadedAt < 5000) return catalog;
    if (pending) return pending;
    const c = getContext(),
      token = generation,
      requestedKey = key();
    if (!c.cwd) throw new Error('Choisissez un projet pour voir ses commandes.');
    catalogKey = requestedKey;
    pending = api(
      `/api/commands?cwd=${encodeURIComponent(c.cwd)}${c.sessionId ? `&sessionId=${encodeURIComponent(c.sessionId)}` : ''}`,
    )
      .then((data) => {
        if (token !== generation || requestedKey !== key())
          throw new Error('Le projet sélectionné a changé.');
        catalog = data;
        loadedAt = Date.now();
        return data;
      })
      .finally(() => {
        if (token === generation) pending = null;
      });
    return pending;
  }
  function insert(command) {
    if (!command.supported) return;
    const suffix = input.value.startsWith('/') ? input.value.replace(/^\/\S*\s*/, '') : input.value;
    input.value = `/${command.name} ${suffix}`;
    hide();
    dialog.close();
    dismissed = true;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    onChange();
  }
  function filtered(items, query) {
    const q = normalize(query).replace(/^\//, '');
    return items
      .filter((c) => normalize(`${c.name} ${c.description} ${c.sourceInfo?.scope || ''}`).includes(q))
      .sort(
        (a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || a.name.localeCompare(b.name),
      );
  }
  function renderList() {
    list.replaceChildren();
    const commands = (catalog?.commands || []).filter((c) =>
      filter === 'terminal' ? !c.supported : c.supported && (filter === 'all' || c.source === filter),
    );
    const visible = filtered(commands, search.value);
    note.textContent = catalog?.live
      ? 'Ressources chargées dans cette session.'
      : 'Ressources du projet pour les nouvelles sessions. Les extensions déjà chargées apparaissent pendant l’exécution.';
    if (catalog?.diagnostics?.length)
      note.textContent += ` ${catalog.diagnostics.map((d) => d.message).join(' · ')}`;
    for (const command of visible) {
      const row = node('button', 'command-item');
      row.type = 'button';
      row.disabled = !command.supported;
      const name = node('span', 'command-name', `/${command.name}`);
      name.append(node('small', '', command.argumentHint || labels[command.source]));
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
    if (!visible.length) list.append(node('p', 'command-empty', 'Aucun résultat pour ce filtre.'));
    for (const [value, b] of filterButtons) b.setAttribute('aria-pressed', String(value === filter));
  }
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
  async function open(selected = 'all') {
    hide();
    filter = selected;
    search.value = '';
    list.replaceChildren();
    note.textContent = 'Lecture du catalogue Prime Agent…';
    dialog.showModal();
    search.focus();
    try {
      await load();
      if (dialog.open) renderList();
    } catch (error) {
      note.textContent = error.message;
    }
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
      !/^\/[^\s]*$/.test(input.value) ||
      getContext().readOnly
    ) {
      hide();
      return;
    }
    const text = input.value,
      requestedKey = key();
    try {
      await load();
      if (text !== input.value || requestedKey !== key() || dismissed || document.activeElement !== input)
        return;
      matches = filtered(
        catalog.commands.filter((c) => c.supported),
        text,
      ).slice(0, 12);
      index = 0;
      popup.replaceChildren();
      if (!matches.length) {
        hide();
        return;
      }
      matches.forEach((c, i) => {
        const row = node('div', 'command-suggestion');
        row.id = `command-option-${i}`;
        row.setAttribute('role', 'option');
        row.append(node('strong', '', `/${c.name}`), node('span', '', c.description || labels[c.source]));
        row.onpointerdown = (event) => event.preventDefault();
        row.onclick = () => insert(c);
        popup.append(row);
      });
      popup.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      selectIndex();
      position();
    } catch {
      hide();
    }
  }
  function selectIndex() {
    [...popup.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
    const row = popup.children[index];
    input.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
  }
  input.addEventListener(
    'keydown',
    (event) => {
      if (popup.hidden || event.isComposing) return;
      if (['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'].includes(event.key)) {
        if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape') {
          dismissed = true;
          hide();
        } else if (event.key === 'Tab' || event.key === 'Enter') insert(matches[index]);
        else {
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
    async intercept() {
      const draft = input.value;
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
        const data = await load();
        if (input.value !== draft || contextKey !== key()) return true;
        const name = Object.hasOwn(aliases, parsed[1]) ? aliases[parsed[1]] : parsed[1],
          args = (parsed[2] || '').trim();
        const command = data.commands.find((c) => c.name === name);
        if (!command)
          throw new Error(`Commande /${name} inconnue. Ouvrez le menu / pour voir les commandes du projet.`);
        if (!command.supported) throw new Error(command.reason);
        hide();
        if (command.source !== 'studio') return false;
        if (hasAttachments())
          throw new Error('Retirez les pièces jointes avant d’utiliser ce raccourci du Studio.');
        input.value = '';
        onChange();
        try {
          await action(command.action, args);
        } catch (error) {
          if (contextKey === key() && !input.value) {
            input.value = draft;
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
