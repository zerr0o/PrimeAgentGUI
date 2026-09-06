import { thinkingLabels } from './reasoning.js';

export function createSubagentSettings({
  api,
  root,
  getModels,
  openModelPicker,
  icon,
  toast,
  project = false,
}) {
  const prefix = project ? 'project-subagent' : 'default-subagent';
  let data = null,
    cwd = '',
    busy = false,
    generation = 0,
    needsLoad = true;
  let context = {},
    draft = { model: '', thinking: '' };
  root.innerHTML = `
    <form class="subagent-form">
      <div class="subagent-heading">
        <h3>${project ? 'Sous-agents du projet' : 'Sous-agents'}</h3>
        ${
          project
            ? '<select class="subagent-scope" aria-label="Réglages des sous-agents du projet"><option value="global">Globaux</option><option value="project">Ce projet</option></select>'
            : '<button id="save-subagent-defaults" class="primary-button" type="submit">Enregistrer</button>'
        }
      </div>
      <fieldset class="subagent-fields">
        <div class="subagent-controls">
          <div class="subagent-model-field"><label id="${prefix}-model-label">Modèle</label>
            <button id="${prefix}-model" class="model-picker-button" type="button" aria-haspopup="dialog" aria-controls="model-dialog" aria-expanded="false">
              <span class="subagent-model-icon"></span>
              <span class="model-picker-selection"><span class="model-picker-name"></span><span class="model-picker-provider"></span></span>
              <span class="model-picker-chevron"></span>
            </button>
          </div>
          <label class="subagent-thinking-field" for="${prefix}-thinking">Réflexion<select id="${prefix}-thinking"></select></label>
        </div>
      </fieldset>
      <p class="subagent-status" role="status"></p>
      ${project ? '' : '<p class="model-defaults-note">Valeurs par défaut pour tous les projets. Les réglages propres à un projet se trouvent dans l’onglet Agents d’une session. Les choix explicites restent prioritaires ; les sous-agents déjà créés conservent leurs réglages.</p>'}
      <p class="subagent-error form-error" role="alert" hidden></p>
      <button class="subagent-reload inspector-refresh" type="button" hidden>Recharger les réglages</button>
    </form>`;
  const $ = (selector) => root.querySelector(selector);
  const modelButton = $(`#${prefix}-model`),
    thinkingSelect = $(`#${prefix}-thinking`);
  $('.subagent-model-icon').append(icon('model'));
  $('.model-picker-chevron').append(icon('chevron'));
  $(`#${prefix}-model-label`).setAttribute('for', modelButton.id);
  const option = (value, label) =>
    Object.assign(document.createElement('option'), { value, textContent: label });

  function error(message = '') {
    $('.subagent-error').textContent = message;
    $('.subagent-error').hidden = !message;
  }
  function controls() {
    const disabled = busy || !data || (project && (context.readOnly || !context.online));
    $('.subagent-fields').hidden = project && (!data || $('.subagent-scope').value === 'global');
    $('.subagent-fields').disabled = disabled;
    if (project) $('.subagent-scope').disabled = disabled;
    else $('#save-subagent-defaults').disabled = disabled;
  }
  function render(preserve = true) {
    const model = getModels().find((m) => m.id === draft.model);
    const name = model?.name || (draft.model ? `Indisponible · ${draft.model}` : 'Modèle parent');
    modelButton.value = draft.model;
    $('.model-picker-name').textContent = name;
    $('.model-picker-provider').textContent =
      model?.provider || (draft.model ? 'Modèle indisponible' : 'Hériter du parent');
    modelButton.title = draft.model || 'Utiliser le modèle de l’agent parent';
    modelButton.setAttribute('aria-label', `Modèle des sous-agents. ${name}${model ? ', ' + model.id : ''}`);
    const levels = model
      ? model.thinkingLevels || (model.reasoning ? Object.keys(thinkingLabels) : ['off'])
      : Object.keys(thinkingLabels);
    thinkingSelect.replaceChildren(option('', 'Niveau parent'));
    for (const level of levels) thinkingSelect.append(option(level, thinkingLabels[level] || level));
    if (draft.thinking && !levels.includes(draft.thinking)) {
      if (preserve) {
        const missing = option(
          draft.thinking,
          `Indisponible · ${thinkingLabels[draft.thinking] || draft.thinking}`,
        );
        missing.disabled = true;
        thinkingSelect.append(missing);
      } else draft.thinking = '';
    }
    thinkingSelect.value = draft.thinking;
    if (project) $('.subagent-scope').value = data?.project === null ? 'global' : 'project';
    controls();
  }
  function status(message) {
    $('.subagent-status').textContent = message;
  }
  function savedStatus() {
    status(
      project
        ? `${data.project === null ? 'Réglages globaux' : 'Réglages du projet'} · prochaines délégations`
        : 'Appliqué aux prochaines délégations dans tous les projets.',
    );
  }
  const endpoint = () =>
    project ? `/api/project-subagent-defaults?cwd=${encodeURIComponent(cwd)}` : '/api/subagent-defaults';
  async function load() {
    const turn = ++generation;
    busy = true;
    needsLoad = false;
    error();
    status('Chargement des réglages…');
    controls();
    try {
      const response = await api(endpoint());
      if (turn !== generation) return;
      data = response;
      draft = { ...(project ? data.effective : data.global) };
      $('.subagent-reload').hidden = true;
      render();
      savedStatus();
    } catch (e) {
      if (turn !== generation) return;
      data = null;
      status('Réglages indisponibles.');
      error(
        e.status === 404
          ? 'Rechargez le Studio après sa mise à jour pour accéder à ces réglages.'
          : e.message,
      );
      $('.subagent-reload').hidden = false;
    } finally {
      if (turn === generation) {
        busy = false;
        controls();
      }
    }
  }
  async function save(policy = { ...draft }) {
    if (busy || !data || (project && (context.readOnly || !context.online))) return;
    const turn = ++generation;
    const body = { revision: data.revision, policy, ...(project ? { cwd } : {}) };
    busy = true;
    controls();
    error();
    status('Enregistrement…');
    try {
      const saved = await api(endpoint(), { method: 'POST', body });
      if (turn !== generation) return;
      data = saved;
      draft = { ...(project ? data.effective : data.global) };
      $('.subagent-reload').hidden = true;
      render();
      savedStatus();
      document.dispatchEvent(
        new CustomEvent('subagent-defaults-changed', { detail: { source: root, cwd: project ? cwd : null } }),
      );
      if (!project) toast('Réglages des sous-agents enregistrés.');
    } catch (e) {
      if (turn !== generation) return;
      status('Modification non enregistrée.');
      if (project) $('.subagent-scope').value = data.project === null ? 'global' : 'project';
      error(e.message);
      $('.subagent-reload').hidden = false;
    } finally {
      if (turn === generation) {
        busy = false;
        controls();
      }
    }
  }
  modelButton.onclick = () => {
    render();
    const turn = generation;
    openModelPicker({
      button: modelButton,
      value: draft.model,
      title: 'Modèle des sous-agents',
      defaultLabel: 'Hériter du modèle parent',
      defaultDetail: 'Utiliser le modèle de l’agent qui délègue',
      onSelect(model) {
        if (turn !== generation || busy || !data) return;
        draft.model = model;
        render(false);
        if (project) void save();
      },
    });
  };
  thinkingSelect.onchange = () => {
    draft.thinking = thinkingSelect.value;
    if (project) void save();
  };
  if (project)
    $('.subagent-scope').onchange = () => {
      void save($('.subagent-scope').value === 'global' ? null : { ...draft });
    };
  $('.subagent-form').onsubmit = (event) => {
    event.preventDefault();
    void save();
  };
  $('.subagent-reload').onclick = () => void load();
  function update(next = context) {
    context = next;
    if (!project) return;
    const nextCwd = context.enabled ? context.cwd || '' : '';
    if (cwd !== nextCwd) {
      generation++;
      cwd = nextCwd;
      data = null;
      busy = false;
      needsLoad = true;
      error();
      draft = { model: '', thinking: '' };
      render();
    }
    root.hidden = !cwd;
    controls();
    if (cwd && context.active && context.online && needsLoad && !busy) void load();
  }
  document.addEventListener('subagent-defaults-changed', (event) => {
    if (!project || event.detail.source === root || (event.detail.cwd && event.detail.cwd !== cwd)) return;
    needsLoad = true;
    update();
  });
  render();
  return { open: load, update };
}
