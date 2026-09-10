import { t as tr, bindText, bindAttribute, translateKnown } from './i18n.js';
import { filePresentation } from './file-presentation.js';
import { thinkingLabel } from './reasoning.js';
import { createSubagentSettings } from './subagent-settings.js';

const $ = (id) => document.getElementById(id);
const node = (tag, className = '', text = '') => {
  const el = document.createElement(tag);
  el.className = className;
  bindText(el, () => text);
  return el;
};
const labels = {
  get working() {
    return tr('ui.travaille');
  },
  get tool() {
    return tr('ui.execute_un_outil');
  },
  get children() {
    return tr('ui.attend_ses_sous_agents');
  },
  get waiting() {
    return tr('ui.en_attente');
  },
  get queued() {
    return tr('ui.dans_la_file');
  },
  get compacting() {
    return tr('ui.resume_le_contexte');
  },
  get completed() {
    return tr('ui.termine');
  },
  get idle() {
    return tr('ui.disponible');
  },
  get saved() {
    return tr('ui.historique');
  },
  failed: tr('common.error'),
  get stopped() {
    return tr('ui.arrete');
  },
  get stopping() {
    return tr('ui.arret_en_cours');
  },
  get unknown() {
    return tr('ui.etat_inconnu');
  },
};
const busy = new Set(['working', 'tool', 'children', 'waiting', 'queued', 'compacting']);
const count = (number) =>
  new Intl.NumberFormat('fr-FR', {
    notation: number >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(number);
const statusNode = (status) =>
  node('span', `inspector-status is-${status}`, () => labels[status] || labels.unknown);

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
  const close = node('button', 'secondary-button', () => tr('ui.fermer'));
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
  const empty = (element, message) => element.replaceChildren(node('p', 'inspector-empty', () => message));
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
        throw new DOMException(tr('ui.vue_remplacee'), 'AbortError');
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
    section.replaceChildren(node('div', 'context-label', () => tr('ui.consommation_de_la_session')));
    const dl = node('dl', 'session-properties');
    for (const [name, value] of [
      [tr('ui.tokens_entrants'), usage.input],
      [tr('ui.tokens_sortants'), usage.output],
      [tr('ui.tokens_en_cache'), usage.cache],
    ]) {
      const row = node('div');
      row.append(
        node('dt', '', () => name),
        node('dd', '', () => count(value)),
      );
      dl.append(row);
    }
    if (usage.cost !== null) {
      const row = node('div');
      row.append(
        node('dt', '', () => tr('ui.cout_estime')),
        node('dd', '', () =>
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
      node('p', 'inspector-note', () =>
        tr('ui.donnees_du_moteur_pour_cet_agent_le_cout_indique_ne_represente_pa'),
      ),
    );
  }
  function renderAgents() {
    const data = agentData,
      list = $('inspector-agent-list');
    if (!data?.session) {
      empty(list, () => tr('ui.ouvrez_une_session_pour_retrouver_son_agent_et_ses_delegations'));
      return;
    }
    const total = data.agents.filter((agent) => !agent.root).length;
    bindText($('inspector-agent-count'), () => total);
    $('inspector-agent-count').hidden = !total;
    const running = data.agents.filter((agent) => busy.has(agent.status)).length;
    bindText($('inspector-agent-summary'), () =>
      tr('count.subagents', {
        count: total,
        activity: running ? tr('ui.en_activite', { value1: running }) : '',
      }),
    );
    bindText(
      $('inspector-agent-note'),
      () =>
        (data.notes || []).map(translateKnown).join(' ') ||
        (data.live ? tr('ui.suivi_en_direct') : tr('ui.delegations_conservees_par_prime_agent')),
    );
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
        node('span', 'inspector-agent-kind', () =>
          agent.root
            ? tr('ui.agent_principal')
            : tr('agents.child', { value1: depth > 1 ? tr('agents.level', { value1: depth }) : '' }),
        ),
        node('strong', 'inspector-agent-name', () => agent.name),
        statusNode(agent.status),
      );
      if (agent.model) card.append(node('span', 'inspector-agent-model', () => agent.model));
      card.append(
        node('span', 'inspector-agent-thinking', () =>
          tr('ui.reflexion_2', { value1: thinkingLabel(agent.thinking) }),
        ),
      );
      if (agent.preview || translateKnown(agent.error))
        card.append(
          node('span', 'inspector-agent-preview', () => translateKnown(agent.error) || agent.preview),
        );
      if (agent.toolUseCount)
        card.append(node('span', 'inspector-note', () => tr('count.tools', { count: agent.toolUseCount })));
      bindAttribute(card, 'aria-label', () =>
        tr('ui.voir_les_details', { value1: agent.name, value2: labels[agent.status] || labels.unknown }),
      );
      card.onclick = () => openAgent(agent);
      list.append(card);
      for (const child of data.agents.filter((child) => child.parentId === agent.id)) add(child, depth + 1);
    }
    for (const agent of data.agents.filter((agent) => agent.root)) add(agent);
    for (const agent of data.agents) if (!seen.has(agent.id)) add(agent, 1);
    if (!total)
      list.append(
        node('p', 'inspector-empty', () => tr('ui.aucun_sous_agent_enregistre_pour_cette_session')),
      );
    if (data.truncated)
      list.append(node('p', 'inspector-note', () => tr('ui.les_200_premiers_sous_agents_sont_affiches')));
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
    if (!agentData) bindText($('inspector-agent-note'), () => tr('ui.chargement_des_agents'));
    try {
      agentData = await request('agents', `/api/inspector?${query({ sessionId: current.sessionId })}`);
      renderAgents();
      showUsage();
      if (agentData.session) $('detail-status').replaceChildren(statusNode(agentData.session.status));
    } catch (error) {
      if (error.name !== 'AbortError')
        bindText($('inspector-agent-note'), () => translateKnown(error.message));
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
      bindText(note, () =>
        fileData.git
          ? tr('count.filesChanged', { branch: fileData.branch, count: fileData.total })
          : translateKnown(fileData.reason),
      );
      for (const file of fileData.entries) {
        const row = node('button', 'inspector-file');
        row.type = 'button';
        row.dataset.filePath = file.path;
        const code = file.untracked ? '+' : file.deleted ? '−' : file.status.includes('R') ? 'R' : 'M';
        row.append(
          node(
            'span',
            `inspector-file-status ${file.deleted ? 'is-deleted' : file.untracked ? 'is-added' : ''}`,
            () => code,
          ),
          node('span', 'inspector-file-path', () => file.path),
        );
        bindAttribute(row, 'title', () =>
          [
            file.previousPath ? `${file.previousPath} → ${file.path}` : file.path,
            file.staged ? tr('ui.contient_des_modifications_indexees') : tr('ui.non_indexe'),
          ].join(' · '),
        );
        row.onclick = () => openFile(file, 'diff');
        list.append(row);
      }
      if (!fileData.entries.length)
        empty(list, () =>
          fileData.git
            ? tr('ui.aucune_modification_dans_ce_projet')
            : tr('ui.utilisez_parcourir_pour_consulter_ses_fichiers'),
        );
      if (fileData.truncated)
        list.append(
          node('p', 'inspector-note', () => tr('ui.les_1_000_premieres_modifications_sont_affichees')),
        );
    } else {
      bindText(note, () => tr('ui.lecture_seule_dossiers_techniques_masques'));
      const root = node('button', '', () => tr('ui.projet'));
      root.type = 'button';
      root.onclick = () => browse('');
      crumb.append(root);
      const parts = directory.split('/').filter(Boolean);
      parts.forEach((part, index) => {
        const button = node('button', '', () => part);
        button.type = 'button';
        button.onclick = () => browse(parts.slice(0, index + 1).join('/'));
        crumb.append(
          node('span', '', () => '/'),
          button,
        );
      });
      for (const file of fileData.entries) {
        const row = node('button', 'inspector-file');
        row.type = 'button';
        row.dataset.filePath = file.path;
        row.append(
          node('span', 'inspector-file-symbol', () => (file.directory ? '▸' : '·')),
          node('span', 'inspector-file-path', () => file.name),
        );
        bindAttribute(
          row,
          'aria-label',
          () => `${file.directory ? tr('ui.ouvrir_le_dossier') : tr('common.view')} ${file.name}`,
        );
        row.onclick = () => (file.directory ? browse(file.path) : openFile(file, 'preview'));
        list.append(row);
      }
      if (!fileData.total) empty(list, () => tr('ui.ce_dossier_est_vide'));
      if (fileData.nextOffset !== null) {
        const more = node('button', 'inspector-more', () => tr('ui.afficher_la_suite'));
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
    if (!fileData) bindText($('inspector-file-note'), () => tr('ui.chargement_des_fichiers'));
    const mode = fileMode;
    try {
      fileData = await request(
        'files',
        mode === 'changes' ? filesUrl('changes') : filesUrl('', { path: directory, offset }),
      );
      renderFiles(offset > 0);
    } catch (error) {
      if (error.name !== 'AbortError') {
        bindText($('inspector-file-note'), () => translateKnown(error.message));
        if (!fileData) empty($('inspector-file-list'), () => tr('ui.reessayez_avec_le_bouton_actualiser'));
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
    bindText(title, () => name);
    controls.replaceChildren();
    empty(body, () => tr('common.loading'));
    if (!viewer.open) viewer.showModal();
  }
  function renderFileText(file, text) {
    const presentation = filePresentation(file.path, text);
    let source = false;
    const options = node('div', 'inspector-text-options');
    options.setAttribute('role', 'group');
    bindAttribute(options, 'aria-label', () => tr('ui.presentation_du_fichier'));
    const buttons = [];
    function render() {
      body.replaceChildren();
      for (const [button, value] of buttons) button.setAttribute('aria-pressed', String(value === source));
      if (!source && presentation.kind === 'markdown') {
        const document = markdown(text, { cwd: current.cwd, basePath: file.path });
        document.classList.add('inspector-document');
        body.append(document);
      } else {
        const pre = node('pre', 'inspector-code inspector-file-source', () =>
          source ? text : presentation.text,
        );
        pre.tabIndex = 0;
        bindAttribute(pre, 'aria-label', () =>
          source ? tr('ui.source_du_fichier') : tr('ui.contenu_du_fichier'),
        );
        body.append(pre);
      }
      body.scrollTop = 0;
    }
    if (presentation.kind !== 'text') {
      for (const [value, label] of [
        [false, tr('ui.apercu')],
        [true, tr('ui.source')],
      ]) {
        const button = node('button', '', () => translateKnown(label));
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
        ['diff', tr('ui.modifications')],
        ['preview', tr('files.content')],
      ]) {
        if (value === 'preview' && file.deleted) continue;
        const button = node('button', '', () => translateKnown(label));
        button.type = 'button';
        button.setAttribute('aria-pressed', String(value === mode));
        button.onclick = () => openFile(file, value);
        controls.append(button);
      }
    }
    if (!file.deleted && !current.readOnly && current.nativeFileOpen) {
      const open = node('button', 'inspector-open', () =>
        current.remote ? tr('ui.ouvrir_sur_le_pc') : tr('ui.ouvrir'),
      );
      open.type = 'button';
      bindAttribute(open, 'title', () => tr('ui.ouvrir_dans_l_application_du_pc'));
      const cwd = current.cwd;
      open.onclick = async () => {
        open.disabled = true;
        const feedback =
          controls.querySelector('.inspector-open-feedback') ||
          node('span', 'inspector-note inspector-open-feedback');
        feedback.setAttribute('role', 'status');
        bindText(feedback, () => tr('ui.ouverture_sur_le_pc'));
        controls.append(feedback);
        try {
          await api('/api/project-files/open', { method: 'POST', body: { cwd, path: file.path } });
          bindText(feedback, () => tr('ui.ouverture_demandee_sur_le_pc'));
        } catch (error) {
          bindText(feedback, () => translateKnown(error.message));
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
        bindAttribute(image, 'alt', () => file.path);
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
                () => line || ' ',
              ),
            );
          body.append(
            node('p', 'inspector-note', () =>
              tr('ui.etat_actuel_compare_au_dernier_commit_head_index_et_fichiers_de_t'),
            ),
          );
        } else bindText(pre, () => data.text);
        body.append(pre);
      } else empty(body, () => data.message || tr('ui.fichier_vide'));
    } catch (error) {
      if (error.name !== 'AbortError' && token === viewVersion) empty(body, translateKnown(error.message));
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
      empty(body, () => tr('ui.plusieurs_documents_portent_ce_nom_choisissez_le_fichier_a_consul'));
      for (const match of result.matches || []) {
        const button = node('button', 'inspector-file', () => match.path);
        button.type = 'button';
        button.onclick = () => openFile(match, 'preview');
        body.append(button);
      }
    } catch (error) {
      if (error.name !== 'AbortError') empty(body, translateKnown(error.message));
    }
  }
  async function openAgent(agent) {
    beginView(agent.name);
    controls.append(statusNode(agent.status));
    if (agent.model) controls.append(node('span', 'inspector-note', () => agent.model));
    controls.append(
      node('span', 'inspector-note', () => tr('ui.reflexion_2', { value1: thinkingLabel(agent.thinking) })),
    );
    if (!agent.history) {
      empty(
        body,
        () => agent.preview || tr('ui.la_conversation_sera_disponible_des_son_enregistrement_par_prime'),
      );
      return;
    }
    const refresh = node('button', '', () => tr('ui.actualiser'));
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
        body.append(node('p', 'inspector-note', () => tr('ui.les_150_derniers_messages_sont_affiches')));
      for (const message of data.messages) {
        if (!message.text && !message.tools?.length) continue;
        const article = node('article', 'inspector-message');
        article.append(
          node('strong', '', () =>
            message.role === 'user'
              ? tr('agents.instruction')
              : message.role === 'assistant'
                ? tr('ui.agent')
                : tr('ui.contexte'),
          ),
        );
        if (message.text) article.append(markdown(message.text));
        for (const tool of message.tools || []) {
          const details = node('details', 'inspector-tool');
          details.append(
            node(
              'summary',
              '',
              () =>
                `${tool.name || tr('common.tool')} · ${tool.status === 'done' ? tr('ui.termine') : tool.status === 'error' ? tr('common.error') : tr('ui.appel_enregistre')}`,
            ),
          );
          details.append(
            node('pre', 'inspector-code', () =>
              typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.args || {}, null, 2),
            ),
          );
          article.append(details);
        }
        body.append(article);
      }
      if (!body.childElementCount) empty(body, () => tr('ui.aucun_message_enregistre_pour_le_moment'));
    } catch (error) {
      if (error.name !== 'AbortError') empty(body, translateKnown(error.message));
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
      bindText($('inspector-agent-note'), () => '');
      bindText($('inspector-agent-summary'), () =>
        current.sessionId ? tr('ui.delegations_de_la_session') : tr('ui.prochaines_delegations'),
      );
      bindText($('inspector-file-note'), () => '');
      $('inspector-file-breadcrumb').replaceChildren();
      empty($('inspector-agent-list'), () =>
        current.sessionId
          ? tr('ui.chargement_des_agents')
          : current.cwd
            ? tr('ui.les_agents_apparaitront_apres_le_premier_message')
            : tr('ui.choisissez_un_projet_pour_preparer_ses_sous_agents'),
      );
      empty($('inspector-file-list'), () =>
        current.cwd
          ? tr('ui.chargement_des_fichiers')
          : tr('ui.choisissez_un_projet_pour_parcourir_ses_fichiers'),
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
    async openAgentById(id) {
      update();
      const expectedContext = contextKey;
      const expectedGeneration = generation;
      const data = await api(`/api/inspector?${query({ sessionId: current.sessionId })}`);
      if (expectedContext !== contextKey || expectedGeneration !== generation) return;
      const agent = data.agents.find((entry) => entry.id === id);
      if (!agent) throw new Error(tr('ui.la_conversation_sera_disponible_des_son_enregistrement_par_prime'));
      await openAgent(agent);
    },
    destroy() {
      clearInterval(timer);
      for (const key of [...pending.keys()]) cancel(key);
    },
  };
}
