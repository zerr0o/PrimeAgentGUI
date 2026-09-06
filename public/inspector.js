import { filePresentation } from './file-presentation.js';
import { thinkingLabel } from './reasoning.js';
import { createSubagentSettings } from './subagent-settings.js';

const $ = (id) => document.getElementById(id);
const node = (tag, className = '', text = '') => {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
};
const labels = {
  working: 'Travaille',
  tool: 'Exécute un outil',
  children: 'Attend ses sous-agents',
  waiting: 'En attente',
  queued: 'Dans la file',
  compacting: 'Résume le contexte',
  completed: 'Terminé',
  idle: 'Disponible',
  saved: 'Historique',
  failed: 'Erreur',
  stopped: 'Arrêté',
  stopping: 'Arrêt en cours',
  unknown: 'État inconnu',
};
const busy = new Set(['working', 'tool', 'children', 'waiting', 'queued', 'compacting']);
const count = (number) =>
  new Intl.NumberFormat('fr-FR', {
    notation: number >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(number);
const statusNode = (status) =>
  node('span', `inspector-status is-${status}`, labels[status] || labels.unknown);

export function createInspector({
  api,
  getContext,
  markdown,
  onClose,
  getModels,
  openModelPicker,
  icon,
  toast,
}) {
  let tab = 'session',
    fileMode = 'changes',
    directory = '',
    contextKey = '',
    generation = 0;
  let current = {},
    agentData = null,
    fileData = null,
    agentsAt = 0,
    filesAt = 0,
    lastAgents = '';
  const pending = new Map();
  const panel = $('details-panel');
  const subagentSettings = createSubagentSettings({
    api,
    root: $('project-subagent-settings'),
    getModels,
    openModelPicker,
    icon,
    toast,
    project: true,
  });
  let mobileModal = false;
  const background = [...document.querySelectorAll('#sidebar, .workspace-header, .conversation-column')];
  const previousInert = new Map();
  function syncMobilePanel() {
    const open = innerWidth <= 1080 && panel.classList.contains('mobile-open') && !panel.hidden;
    if (open === mobileModal) return;
    mobileModal = open;
    if (open) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      for (const element of background) {
        previousInert.set(element, element.inert);
        element.inert = true;
      }
      if (!viewer.open) $('close-inspector').focus({ preventScroll: true });
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      for (const [element, value] of previousInert) element.inert = value;
      previousInert.clear();
      if (innerWidth <= 1080) $('toggle-details').focus({ preventScroll: true });
    }
  }
  panel.addEventListener('keydown', (event) => {
    if (!mobileModal || viewer.open || document.querySelector('#model-dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button, select, input, a[href], [tabindex="0"]')].filter(
      (element) => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length,
    );
    const first = focusable[0],
      last = focusable.at(-1);
    if (
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  });
  const viewer = node('dialog', 'modal inspector-viewer');
  viewer.id = 'inspector-viewer';
  viewer.setAttribute('aria-labelledby', 'inspector-view-title');
  const header = node('div', 'inspector-view-header'),
    title = node('h2');
  title.id = 'inspector-view-title';
  const close = node('button', 'secondary-button', 'Fermer');
  close.type = 'button';
  close.onclick = () => viewer.close();
  const controls = node('div', 'inspector-view-controls'),
    body = node('div', 'inspector-view-body');
  body.id = 'inspector-view-body';
  header.append(title, close);
  viewer.append(header, controls, body);
  document.body.append(viewer);
  let viewVersion = 0,
    opener;
  const visible = () => !panel.hidden && (innerWidth > 1080 || panel.classList.contains('mobile-open'));
  const query = (values) => new URLSearchParams({ cwd: current.cwd, ...values }).toString();
  const filesUrl = (action, values = {}) =>
    `/api/project-files${action ? '/' + action : ''}?${query(values)}`;
  const empty = (element, message) => element.replaceChildren(node('p', 'inspector-empty', message));
  const cancel = (key) => {
    pending.get(key)?.abort();
    pending.delete(key);
  };
  async function request(key, url) {
    cancel(key);
    const controller = new AbortController(),
      token = generation;
    pending.set(key, controller);
    try {
      const data = await api(url, { signal: controller.signal });
      if (token !== generation || controller.signal.aborted)
        throw new DOMException('Vue remplacée', 'AbortError');
      return data;
    } finally {
      if (pending.get(key) === controller) pending.delete(key);
    }
  }
  function showUsage() {
    const usage = agentData?.session?.usage;
    const section = $('inspector-usage');
    section.hidden = !usage;
    if (!usage) return;
    section.replaceChildren(node('div', 'context-label', 'CONSOMMATION DE LA SESSION'));
    const dl = node('dl', 'session-properties');
    for (const [name, value] of [
      ['Tokens entrants', usage.input],
      ['Tokens sortants', usage.output],
      ['Tokens en cache', usage.cache],
    ]) {
      const row = node('div');
      row.append(node('dt', '', name), node('dd', '', count(value)));
      dl.append(row);
    }
    if (usage.cost !== null) {
      const row = node('div');
      row.append(
        node('dt', '', 'Coût estimé'),
        node(
          'dd',
          '',
          new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 4,
          }).format(usage.cost),
        ),
      );
      dl.append(row);
    }
    section.append(
      dl,
      node(
        'p',
        'inspector-note',
        'Données du moteur pour cet agent. Le coût indiqué ne représente pas la facturation de votre abonnement.',
      ),
    );
  }
  function renderAgents() {
    const data = agentData,
      list = $('inspector-agent-list');
    if (!data?.session) {
      empty(list, 'Ouvrez une session pour retrouver son agent et ses délégations.');
      return;
    }
    const total = data.agents.filter((agent) => !agent.root).length;
    $('inspector-agent-count').textContent = total;
    $('inspector-agent-count').hidden = !total;
    const running = data.agents.filter((agent) => busy.has(agent.status)).length;
    $('inspector-agent-summary').textContent =
      `${total} sous-agent${total > 1 ? 's' : ''}${running ? ` · ${running} en activité` : ''}`;
    $('inspector-agent-note').textContent =
      (data.notes || []).join(' ') ||
      (data.live ? 'Suivi en direct' : 'Délégations conservées par Prime Agent.');
    const fingerprint = JSON.stringify(data);
    if (fingerprint === lastAgents) return;
    lastAgents = fingerprint;
    const focusedId = document.activeElement?.closest('[data-agent-id]')?.dataset.agentId;
    list.replaceChildren();
    const seen = new Set();
    function add(agent, depth = 0) {
      if (seen.has(agent.id)) return;
      seen.add(agent.id);
      const card = node('button', 'inspector-agent');
      card.type = 'button';
      card.dataset.agentId = agent.id;
      card.style.setProperty('--agent-depth', Math.min(depth, 4));
      card.append(
        node(
          'span',
          'inspector-agent-kind',
          agent.root ? 'Agent principal' : `Sous-agent${depth > 1 ? ` · niveau ${depth}` : ''}`,
        ),
        node('strong', 'inspector-agent-name', agent.name),
        statusNode(agent.status),
      );
      if (agent.model) card.append(node('span', 'inspector-agent-model', agent.model));
      card.append(node('span', 'inspector-agent-thinking', `Réflexion · ${thinkingLabel(agent.thinking)}`));
      if (agent.preview || agent.error)
        card.append(node('span', 'inspector-agent-preview', agent.error || agent.preview));
      if (agent.toolUseCount)
        card.append(node('span', 'inspector-note', `${agent.toolUseCount} appels d’outil`));
      card.setAttribute(
        'aria-label',
        `${agent.name} · ${labels[agent.status] || labels.unknown} · Voir les détails`,
      );
      card.onclick = () => openAgent(agent);
      list.append(card);
      for (const child of data.agents.filter((child) => child.parentId === agent.id)) add(child, depth + 1);
    }
    for (const agent of data.agents.filter((agent) => agent.root)) add(agent);
    for (const agent of data.agents) if (!seen.has(agent.id)) add(agent, 1);
    if (!total) list.append(node('p', 'inspector-empty', 'Aucun sous-agent enregistré pour cette session.'));
    if (data.truncated)
      list.append(node('p', 'inspector-note', 'Les 200 premiers sous-agents sont affichés.'));
    if (focusedId)
      [...list.children]
        .find((element) => element.dataset.agentId === focusedId)
        ?.focus({ preventScroll: true });
  }
  async function loadAgents(force = false) {
    if (
      !current.enabled ||
      !current.cwd ||
      !current.sessionId ||
      pending.has('agents') ||
      (!force && Date.now() - agentsAt < 4000)
    )
      return;
    agentsAt = Date.now();
    if (!agentData) $('inspector-agent-note').textContent = 'Chargement des agents…';
    try {
      agentData = await request('agents', `/api/inspector?${query({ sessionId: current.sessionId })}`);
      renderAgents();
      showUsage();
      if (agentData.session) $('detail-status').replaceChildren(statusNode(agentData.session.status));
    } catch (error) {
      if (error.name !== 'AbortError') $('inspector-agent-note').textContent = error.message;
    }
  }
  function setTab(value, focus = false) {
    tab = value;
    for (const key of ['session', 'agents', 'files']) {
      const button = $(`inspector-tab-${key}`);
      button.setAttribute('aria-selected', String(key === tab));
      button.tabIndex = key === tab ? 0 : -1;
      $(`inspector-${key}`).hidden = key !== tab;
    }
    if (focus) $(`inspector-tab-${tab}`).focus();
    update();
  }
  for (const key of ['session', 'agents', 'files']) {
    const button = $(`inspector-tab-${key}`);
    button.onclick = () => setTab(key);
    button.onkeydown = (event) => {
      const keys = ['session', 'agents', 'files'].filter((key) => !$(`inspector-tab-${key}`).disabled);
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      setTab(
        event.key === 'Home'
          ? keys[0]
          : event.key === 'End'
            ? keys.at(-1)
            : keys[(keys.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length],
        true,
      );
    };
  }
  $('close-inspector').onclick = onClose;
  $('refresh-agents').onclick = () => {
    void loadAgents(true);
    if (current.cwd) void subagentSettings.open();
  };

  function renderFiles(append = false) {
    const list = $('inspector-file-list'),
      crumb = $('inspector-file-breadcrumb');
    const focusedPath = document.activeElement?.closest('[data-file-path]')?.dataset.filePath;
    if (!append) list.replaceChildren();
    crumb.replaceChildren();
    const note = $('inspector-file-note');
    if (fileMode === 'changes') {
      note.textContent = fileData.git
        ? `${fileData.branch} · ${fileData.total} fichier${fileData.total > 1 ? 's' : ''} modifié${fileData.total > 1 ? 's' : ''}`
        : fileData.reason;
      for (const file of fileData.entries) {
        const row = node('button', 'inspector-file');
        row.type = 'button';
        row.dataset.filePath = file.path;
        const code = file.untracked ? '+' : file.deleted ? '−' : file.status.includes('R') ? 'R' : 'M';
        row.append(
          node(
            'span',
            `inspector-file-status ${file.deleted ? 'is-deleted' : file.untracked ? 'is-added' : ''}`,
            code,
          ),
          node('span', 'inspector-file-path', file.path),
        );
        row.title = [
          file.previousPath ? `${file.previousPath} → ${file.path}` : file.path,
          file.staged ? 'Contient des modifications indexées' : 'Non indexé',
        ].join(' · ');
        row.onclick = () => openFile(file, 'diff');
        list.append(row);
      }
      if (!fileData.entries.length)
        empty(
          list,
          fileData.git
            ? 'Aucune modification dans ce projet.'
            : 'Utilisez « Parcourir » pour consulter ses fichiers.',
        );
      if (fileData.truncated)
        list.append(node('p', 'inspector-note', 'Les 1 000 premières modifications sont affichées.'));
    } else {
      note.textContent = 'Lecture seule · dossiers techniques masqués';
      const root = node('button', '', 'Projet');
      root.type = 'button';
      root.onclick = () => browse('');
      crumb.append(root);
      const parts = directory.split('/').filter(Boolean);
      parts.forEach((part, index) => {
        const button = node('button', '', part);
        button.type = 'button';
        button.onclick = () => browse(parts.slice(0, index + 1).join('/'));
        crumb.append(node('span', '', '/'), button);
      });
      for (const file of fileData.entries) {
        const row = node('button', 'inspector-file');
        row.type = 'button';
        row.dataset.filePath = file.path;
        row.append(
          node('span', 'inspector-file-symbol', file.directory ? '▸' : '·'),
          node('span', 'inspector-file-path', file.name),
        );
        row.setAttribute('aria-label', `${file.directory ? 'Ouvrir le dossier' : 'Consulter'} ${file.name}`);
        row.onclick = () => (file.directory ? browse(file.path) : openFile(file, 'preview'));
        list.append(row);
      }
      if (!fileData.total) empty(list, 'Ce dossier est vide.');
      if (fileData.nextOffset !== null) {
        const more = node('button', 'inspector-more', 'Afficher la suite');
        more.type = 'button';
        more.onclick = () => {
          more.remove();
          void loadFiles(true, fileData.nextOffset);
        };
        list.append(more);
      }
    }
    if (focusedPath)
      [...list.children]
        .find((element) => element.dataset.filePath === focusedPath)
        ?.focus({ preventScroll: true });
  }
  async function loadFiles(force = false, offset = 0) {
    if (!current.enabled || !current.cwd || pending.has('files') || (!force && Date.now() - filesAt < 6000))
      return;
    filesAt = Date.now();
    if (!fileData) $('inspector-file-note').textContent = 'Chargement des fichiers…';
    const mode = fileMode;
    try {
      fileData = await request(
        'files',
        mode === 'changes' ? filesUrl('changes') : filesUrl('', { path: directory, offset }),
      );
      renderFiles(offset > 0);
    } catch (error) {
      if (error.name !== 'AbortError') {
        $('inspector-file-note').textContent = error.message;
        if (!fileData) empty($('inspector-file-list'), 'Réessayez avec le bouton Actualiser.');
      }
    }
  }
  function browse(path) {
    cancel('files');
    directory = path;
    fileData = null;
    fileMode = 'all';
    void loadFiles(true);
  }
  function changeFiles(mode) {
    cancel('files');
    fileMode = mode;
    fileData = null;
    filesAt = 0;
    $('files-changes').setAttribute('aria-pressed', String(mode === 'changes'));
    $('files-all').setAttribute('aria-pressed', String(mode === 'all'));
    $('inspector-file-list').replaceChildren();
    void loadFiles(true);
  }
  $('files-changes').onclick = () => changeFiles('changes');
  $('files-all').onclick = () => changeFiles('all');
  $('refresh-files').onclick = () => void loadFiles(true);

  function beginView(name) {
    cancel('viewer');
    viewVersion++;
    if (!viewer.open) opener = document.activeElement;
    title.textContent = name;
    controls.replaceChildren();
    empty(body, 'Chargement…');
    if (!viewer.open) viewer.showModal();
  }
  function renderFileText(file, text) {
    const presentation = filePresentation(file.path, text);
    let source = false;
    const options = node('div', 'inspector-text-options');
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', 'Présentation du fichier');
    const buttons = [];
    function render() {
      body.replaceChildren();
      for (const [button, value] of buttons) button.setAttribute('aria-pressed', String(value === source));
      if (!source && presentation.kind === 'markdown') {
        const document = markdown(text, { cwd: current.cwd, basePath: file.path });
        document.classList.add('inspector-document');
        body.append(document);
      } else {
        const pre = node('pre', 'inspector-code inspector-file-source', source ? text : presentation.text);
        pre.tabIndex = 0;
        pre.setAttribute('aria-label', source ? 'Source du fichier' : 'Contenu du fichier');
        body.append(pre);
      }
      body.scrollTop = 0;
    }
    if (presentation.kind !== 'text') {
      for (const [value, label] of [
        [false, 'Aperçu'],
        [true, 'Source'],
      ]) {
        const button = node('button', '', label);
        button.type = 'button';
        button.onclick = () => {
          source = value;
          render();
        };
        buttons.push([button, value]);
        options.append(button);
      }
      controls.insertBefore(options, controls.querySelector('.inspector-open'));
    }
    render();
  }
  async function openFile(file, mode) {
    beginView(file.path);
    const token = viewVersion;
    if (file.status) {
      for (const [value, label] of [
        ['diff', 'Modifications'],
        ['preview', 'Contenu'],
      ]) {
        if (value === 'preview' && file.deleted) continue;
        const button = node('button', '', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(value === mode));
        button.onclick = () => openFile(file, value);
        controls.append(button);
      }
    }
    if (!file.deleted && !current.readOnly && current.nativeFileOpen) {
      const open = node('button', 'inspector-open', current.remote ? 'Ouvrir sur le PC' : 'Ouvrir');
      open.type = 'button';
      open.title = 'Ouvrir dans l’application du PC';
      const cwd = current.cwd;
      open.onclick = async () => {
        open.disabled = true;
        const feedback =
          controls.querySelector('.inspector-open-feedback') ||
          node('span', 'inspector-note inspector-open-feedback');
        feedback.setAttribute('role', 'status');
        feedback.textContent = 'Ouverture sur le PC…';
        controls.append(feedback);
        try {
          await api('/api/project-files/open', { method: 'POST', body: { cwd, path: file.path } });
          feedback.textContent = 'Ouverture demandée sur le PC.';
        } catch (error) {
          feedback.textContent = error.message;
        } finally {
          open.disabled = false;
        }
      };
      controls.append(open);
    }
    try {
      const data = await request('viewer', filesUrl(mode, { path: file.path }));
      if (token !== viewVersion) return;
      body.replaceChildren();
      if (data.image) {
        const image = node('img', 'inspector-preview-image');
        image.src = data.image;
        image.alt = file.path;
        body.append(image);
      } else if (typeof data.text === 'string' && data.text) {
        if (mode !== 'diff') {
          renderFileText(file, data.text);
          return;
        }
        const pre = node('pre', mode === 'diff' ? 'inspector-diff' : 'inspector-code');
        if (mode === 'diff') {
          for (const line of data.text.split('\n'))
            pre.append(
              node(
                'span',
                line.startsWith('@@')
                  ? 'diff-hunk'
                  : line.startsWith('+') && !line.startsWith('+++')
                    ? 'diff-add'
                    : line.startsWith('-') && !line.startsWith('---')
                      ? 'diff-remove'
                      : '',
                line || ' ',
              ),
            );
          body.append(
            node(
              'p',
              'inspector-note',
              'État actuel comparé au dernier commit (HEAD), index et fichiers de travail compris.',
            ),
          );
        } else pre.textContent = data.text;
        body.append(pre);
      } else empty(body, data.message || 'Fichier vide.');
    } catch (error) {
      if (error.name !== 'AbortError' && token === viewVersion) empty(body, error.message);
    }
  }
  async function openDocument(reference, { cwd, basePath = '' } = {}) {
    update();
    if (cwd !== current.cwd) return;
    beginView(reference.split(/[\\/]/).at(-1));
    try {
      const result = await request('viewer', filesUrl('resolve', { reference, basePath }));
      if (result.path) {
        await openFile({ path: result.path }, 'preview');
        return;
      }
      empty(body, 'Plusieurs documents portent ce nom. Choisissez le fichier à consulter.');
      for (const match of result.matches || []) {
        const button = node('button', 'inspector-file', match.path);
        button.type = 'button';
        button.onclick = () => openFile(match, 'preview');
        body.append(button);
      }
    } catch (error) {
      if (error.name !== 'AbortError') empty(body, error.message);
    }
  }
  async function openAgent(agent) {
    beginView(agent.name);
    controls.append(statusNode(agent.status));
    if (agent.model) controls.append(node('span', 'inspector-note', agent.model));
    controls.append(node('span', 'inspector-note', `Réflexion · ${thinkingLabel(agent.thinking)}`));
    if (!agent.history) {
      empty(body, agent.preview || 'La conversation sera disponible dès son enregistrement par Prime Agent.');
      return;
    }
    const refresh = node('button', '', 'Actualiser');
    refresh.type = 'button';
    refresh.onclick = () => openAgent(agentData?.agents.find((row) => row.id === agent.id) || agent);
    controls.append(refresh);
    try {
      const data = await request(
        'viewer',
        `/api/inspector/history?${query({ sessionId: current.sessionId, agentId: agent.id })}`,
      );
      body.replaceChildren();
      if (data.truncated)
        body.append(node('p', 'inspector-note', 'Les 150 derniers messages sont affichés.'));
      for (const message of data.messages) {
        if (!message.text && !message.tools?.length) continue;
        const article = node('article', 'inspector-message');
        article.append(
          node(
            'strong',
            '',
            message.role === 'user' ? 'Consigne' : message.role === 'assistant' ? 'Agent' : 'Contexte',
          ),
        );
        if (message.text) article.append(markdown(message.text));
        for (const tool of message.tools || []) {
          const details = node('details', 'inspector-tool');
          details.append(
            node(
              'summary',
              '',
              `${tool.name || 'Outil'} · ${tool.status === 'done' ? 'Terminé' : tool.status === 'error' ? 'Erreur' : 'Appel enregistré'}`,
            ),
          );
          details.append(
            node(
              'pre',
              'inspector-code',
              typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.args || {}, null, 2),
            ),
          );
          article.append(details);
        }
        body.append(article);
      }
      if (!body.childElementCount) empty(body, 'Aucun message enregistré pour le moment.');
    } catch (error) {
      if (error.name !== 'AbortError') empty(body, error.message);
    }
  }
  viewer.onclose = () => {
    cancel('viewer');
    viewVersion++;
    opener?.focus({ preventScroll: true });
  };
  viewer.addEventListener('cancel', (event) => event.stopPropagation());

  function update() {
    current = getContext();
    syncMobilePanel();
    const key = `${current.cwd || ''}\0${current.sessionId || ''}`;
    if (key !== contextKey) {
      generation++;
      contextKey = key;
      for (const key of [...pending.keys()]) cancel(key);
      agentsAt = filesAt = 0;
      agentData = fileData = null;
      lastAgents = '';
      directory = '';
      if (viewer.open) viewer.close();
      $('inspector-agent-count').hidden = true;
      $('inspector-usage').hidden = true;
      $('inspector-agent-note').textContent = '';
      $('inspector-agent-summary').textContent = current.sessionId
        ? 'Délégations de la session'
        : 'Prochaines délégations';
      $('inspector-file-note').textContent = '';
      $('inspector-file-breadcrumb').replaceChildren();
      empty(
        $('inspector-agent-list'),
        current.sessionId
          ? 'Chargement des agents…'
          : current.cwd
            ? 'Les agents apparaîtront après le premier message.'
            : 'Choisissez un projet pour préparer ses sous-agents.',
      );
      empty(
        $('inspector-file-list'),
        current.cwd ? 'Chargement des fichiers…' : 'Choisissez un projet pour parcourir ses fichiers.',
      );
    }
    if (agentData?.session) $('detail-status').replaceChildren(statusNode(agentData.session.status));
    $('inspector-tab-agents').disabled = !current.enabled;
    $('inspector-tab-files').disabled = !current.enabled;
    subagentSettings.update({ ...current, active: tab === 'agents' && visible() && !document.hidden });
    if (!current.enabled) return;
    if (!visible() || document.hidden || !current.online) return;
    if (tab === 'files') {
      if (fileMode === 'changes' || !fileData) void loadFiles();
    } else void loadAgents();
  }
  const timer = setInterval(update, 2500);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('resize', update);
  return {
    update,
    setTab,
    openDocument,
    destroy() {
      clearInterval(timer);
      for (const key of [...pending.keys()]) cancel(key);
    },
  };
}
