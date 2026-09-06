const node = (tag, className, text) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
};
const sources = {
  stored: 'Enregistré sur ce PC',
  environment: 'Variable d’environnement',
  prime_cli: 'Configuration Prime CLI',
  models_json_key: 'Configuration des modèles',
  models_json_command: 'Gestionnaire de secrets',
  fallback: 'Configuration externe',
  stale: 'À reconnecter',
  runtime: 'Session actuelle',
};
export function createProviderSettings({ api, toast, allowed, onChanged }) {
  const dialog = node('dialog', 'modal providers-modal');
  dialog.id = 'providers-dialog';
  dialog.setAttribute('aria-labelledby', 'providers-title');
  dialog.innerHTML = `<header class="providers-heading"><div><span class="providers-eyebrow">COMPTES ET CLÉS API · CE PC</span><h2 id="providers-title">Fournisseurs</h2></div><button type="button" class="icon-button" id="providers-close" aria-label="Fermer les fournisseurs">×</button></header>
    <div class="providers-content"><div id="providers-error" class="form-error" role="alert" hidden></div><div id="providers-view"></div></div>
    <footer class="providers-footer"><span>Connexions partagées avec Prime Agent sur ce PC.</span><button type="button" class="primary-button" id="providers-done">Terminé</button></footer>`;
  document.body.append(dialog);
  const $ = (id) => dialog.querySelector(`#${id}`),
    view = $('providers-view');
  let data,
    query = '',
    generation = 0,
    jobId,
    timer,
    mode = 'list',
    acting = false;
  const error = (value) => {
    $('providers-error').textContent = value || '';
    $('providers-error').hidden = !value;
  };
  const button = (label, action, style = 'secondary-button') => {
    const item = node('button', style, label);
    item.type = 'button';
    item.onclick = action;
    return item;
  };
  function show(child) {
    view.replaceChildren(child);
    error();
    $('providers-content')?.scrollTo(0, 0);
  }
  async function changed() {
    try {
      await onChanged();
    } catch {
      toast('Connexion enregistrée. Le catalogue sera actualisé à la prochaine ouverture.', true);
    }
  }
  async function load() {
    const current = ++generation;
    mode = 'list';
    clearTimeout(timer);
    show(node('p', 'providers-note', 'Chargement des fournisseurs…'));
    try {
      const next = await api('/api/providers');
      if (!dialog.open || current !== generation) return;
      data = next;
      if (data.activeLogin) {
        jobId = data.activeLogin;
        authView();
        void poll();
        return;
      }
      renderList();
    } catch (e) {
      if (current === generation && dialog.open) {
        show(button('Réessayer', load));
        error(e.message);
      }
    }
  }
  function renderList() {
    mode = 'list';
    const section = node('section');
    section.append(
      node(
        'p',
        'providers-intro',
        'Connectez un compte ou ajoutez une clé API pour retrouver ses modèles dans le Studio. Les clés enregistrées ne sont jamais réaffichées.',
      ),
    );
    if (data.warning) section.append(node('p', 'provider-notice', data.warning));
    if (data.busy)
      section.append(
        node(
          'p',
          'provider-notice',
          'Des agents travaillent. Vous pouvez ajouter un fournisseur ; le remplacement et la déconnexion seront disponibles à la fin des exécutions.',
        ),
      );
    const toolbar = node('div', 'providers-toolbar'),
      search = node('input');
    search.type = 'search';
    search.placeholder = 'Rechercher un fournisseur…';
    search.setAttribute('aria-label', 'Rechercher un fournisseur');
    search.value = query;
    const count = node('p', 'providers-count'),
      list = node('div', 'providers-list');
    list.setAttribute('aria-label', 'Fournisseurs disponibles');
    const draw = () => {
      const tokens = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const entries = data.providers.filter((p) =>
        tokens.every((token) => `${p.name} ${p.id}`.toLocaleLowerCase().includes(token)),
      );
      count.textContent = `${entries.length} fournisseur${entries.length > 1 ? 's' : ''} · ${data.providers.filter((p) => p.configured).length} configuré(s)`;
      list.replaceChildren(...entries.map(card));
      if (!entries.length)
        list.append(
          node(
            'p',
            'providers-note',
            'Aucun fournisseur trouvé. Les fournisseurs personnalisés se créent dans le configurateur de modèles.',
          ),
        );
    };
    search.oninput = () => {
      query = search.value;
      draw();
    };
    toolbar.append(search, button('Actualiser', load));
    section.append(toolbar, count, list);
    show(section);
    draw();
    search.focus();
  }
  function card(entry) {
    const item = node('article', 'provider-card'),
      top = node('div', 'provider-card-top'),
      identity = node('div', 'provider-identity');
    item.dataset.provider = entry.id;
    identity.append(
      node('strong', '', entry.name),
      node(
        'div',
        'provider-meta',
        `${entry.id} · ${entry.models} modèles${entry.source ? ' · ' + (sources[entry.source] || 'Configuration externe') : ''}`,
      ),
    );
    top.append(
      node('span', 'provider-avatar', entry.name.slice(0, 1).toUpperCase()),
      identity,
      node(
        'span',
        `provider-status${entry.configured ? ' configured' : ''}`,
        entry.configured ? 'Configuré' : entry.source === 'stale' ? 'À reconnecter' : 'Non configuré',
      ),
    );
    item.append(top);
    const actions = node('div', 'provider-actions');
    if (entry.methods.includes('oauth'))
      actions.append(
        button(entry.credentialType === 'oauth' ? 'Reconnecter le compte' : 'Connecter un compte', () =>
          startLogin(entry),
        ),
      );
    if (entry.methods.includes('api_key'))
      actions.append(
        button(entry.credentialType === 'api_key' ? 'Remplacer la clé' : 'Ajouter une clé API', () =>
          keyForm(entry),
        ),
      );
    if (entry.stored) actions.append(button('Déconnecter', () => removeForm(entry), 'danger-text'));
    if (data.busy && (entry.stored || entry.configured))
      for (const action of actions.children) {
        action.disabled = true;
        action.title = 'Disponible à la fin des exécutions.';
      }
    if (actions.children.length) item.append(actions);
    if (entry.guidance) item.append(node('p', 'provider-guidance', entry.guidance));
    if (entry.source && entry.source !== 'stored')
      item.append(
        node('p', 'provider-guidance', 'Les réglages externes restent gérés à leur emplacement d’origine.'),
      );
    return item;
  }
  function formShell(title) {
    mode = 'form';
    const form = node('form', 'provider-form');
    form.append(node('h3', '', title));
    show(form);
    return form;
  }
  function label(title, control) {
    const item = node('label', '', title);
    item.append(control);
    return item;
  }
  function keyForm(entry) {
    const form = formShell(entry.name),
      kind = node('select'),
      value = node('input');
    kind.append(new Option('Clé API', 'key'), new Option('Variable d’environnement', 'environment'));
    value.type = 'password';
    value.autocomplete = 'off';
    value.spellcheck = false;
    value.required = true;
    value.maxLength = 8192;
    const valueLabel = label('Clé API', value),
      note = node(
        'p',
        'providers-note',
        'La clé est conservée dans le stockage natif de Prime Agent sur ce PC. Elle n’est pas enregistrée dans le navigateur.',
      );
    kind.onchange = () => {
      value.value = '';
      value.type = kind.value === 'key' ? 'password' : 'text';
      valueLabel.firstChild.textContent = kind.value === 'key' ? 'Clé API' : 'Nom de la variable';
      value.placeholder = kind.value === 'key' ? '' : 'MON_FOURNISSEUR_API_KEY';
    };
    form.append(label('Mode de connexion', kind), valueLabel, note);
    if (entry.stored || entry.configured)
      form.append(
        node(
          'p',
          'provider-notice',
          'Cette action remplace la connexion actuelle de ce fournisseur. Attendez aussi la fin des agents lancés hors du Studio.',
        ),
      );
    if (entry.guidance) form.append(node('p', 'providers-note', entry.guidance));
    const actions = node('div', 'provider-form-actions'),
      save = button('Enregistrer', null, 'primary-button');
    save.type = 'submit';
    actions.append(button('Retour', renderList), save);
    form.append(actions);
    value.focus();
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (acting) return;
      acting = true;
      save.disabled = true;
      error();
      const body = { provider: entry.id, revision: entry.revision, kind: kind.value, value: value.value };
      try {
        await api('/api/providers/key', { method: 'POST', body });
        value.value = '';
        await changed();
        toast('Connexion enregistrée.');
        if (dialog.open) await load();
      } catch (e) {
        error(e.message);
      } finally {
        body.value = '';
        acting = false;
        save.disabled = false;
      }
    };
  }
  function removeForm(entry) {
    const form = formShell(`Déconnecter ${entry.name} ?`);
    form.append(
      node(
        'p',
        'providers-note',
        'Les identifiants enregistrés pour ce fournisseur seront retirés du PC. Les conversations sont conservées. Les variables d’environnement et la configuration Prime CLI ou des modèles restent en place et peuvent continuer à fournir une connexion.',
      ),
    );
    form.append(
      node(
        'p',
        'provider-notice',
        'Cette connexion est partagée avec les agents lancés hors du Studio. Attendez la fin de leur travail avant de la retirer.',
      ),
    );
    const actions = node('div', 'provider-form-actions'),
      remove = button('Confirmer la déconnexion', null, 'danger-text');
    remove.type = 'submit';
    actions.append(button('Annuler', renderList), remove);
    form.append(actions);
    actions.firstChild.focus();
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (acting) return;
      acting = true;
      remove.disabled = true;
      try {
        await api('/api/providers/disconnect', {
          method: 'POST',
          body: { provider: entry.id, revision: entry.revision },
        });
        await changed();
        toast('Identifiants enregistrés retirés.');
        if (dialog.open) await load();
      } catch (e) {
        error(e.message);
      } finally {
        acting = false;
        remove.disabled = false;
      }
    };
  }
  async function startLogin(entry) {
    if (acting) return;
    if (
      (entry.stored || entry.configured) &&
      !confirm(
        `Remplacer la connexion de ${entry.name} ? Attendez aussi la fin des agents lancés hors du Studio.`,
      )
    )
      return;
    acting = true;
    error();
    try {
      const job = await api('/api/providers/login', {
        method: 'POST',
        body: { provider: entry.id, revision: entry.revision },
      });
      jobId = job.id;
      if (dialog.open) {
        authView();
        updateJob(job);
        void poll();
      }
    } catch (e) {
      error(e.message);
    } finally {
      acting = false;
    }
  }
  function authView() {
    mode = 'auth';
    const section = node('section');
    section.append(node('h3', '', 'Connexion au fournisseur'));
    section.append(
      node(
        'p',
        'providers-note',
        'Autorisez la connexion sur le site du fournisseur. Revenez ensuite dans cette fenêtre pour terminer.',
      ),
    );
    const link = node('a', 'primary-button provider-auth-link', 'Ouvrir la page de connexion');
    link.id = 'provider-auth-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.hidden = true;
    const instructions = node('div', 'provider-instructions');
    instructions.id = 'provider-auth-instructions';
    instructions.hidden = true;
    const status = node('p', 'provider-auth-status', 'Préparation de la connexion…');
    status.id = 'provider-auth-status';
    status.setAttribute('role', 'status');
    const prompts = node('div', 'provider-prompts');
    prompts.id = 'provider-auth-prompts';
    const cancel = button('Annuler la connexion', async () => {
      cancel.disabled = true;
      try {
        await api(`/api/providers/login/${jobId}`, { method: 'DELETE' });
        clearTimeout(timer);
        jobId = null;
        await load();
      } catch (e) {
        error(e.message);
      } finally {
        cancel.disabled = false;
      }
    });
    cancel.id = 'provider-auth-cancel';
    section.append(status, link, instructions, prompts, cancel);
    show(section);
  }
  function updateJob(job) {
    const link = $('provider-auth-link'),
      status = $('provider-auth-status');
    if (!link) return;
    link.hidden = !job.url;
    if (job.url) link.href = job.url;
    else link.removeAttribute('href');
    $('provider-auth-instructions').textContent = job.instructions || '';
    $('provider-auth-instructions').hidden = !job.instructions;
    status.textContent =
      {
        preparing: 'Préparation de la connexion…',
        waiting: 'En attente de votre autorisation…',
        saving: 'Enregistrement de la connexion…',
      }[job.status] || '';
    $('provider-auth-cancel').disabled = job.status === 'saving';
    const prompts = $('provider-auth-prompts');
    const ids = new Set(job.prompts.map((p) => p.id));
    for (const existing of [...prompts.children]) if (!ids.has(existing.dataset.prompt)) existing.remove();
    for (const prompt of job.prompts) {
      if ([...prompts.children].some((p) => p.dataset.prompt === prompt.id)) continue;
      const form = node('form', 'provider-form');
      form.dataset.prompt = prompt.id;
      const field = node(prompt.kind === 'select' ? 'select' : 'input');
      if (prompt.kind === 'select')
        for (const option of prompt.options) field.append(new Option(option.label, option.id));
      else {
        field.type = prompt.kind === 'manual' ? 'password' : 'text';
        field.placeholder = prompt.placeholder || '';
        field.autocomplete = 'off';
        field.spellcheck = false;
        field.maxLength = 16000;
      }
      field.required = !prompt.allowEmpty;
      const send = button('Valider', null);
      send.type = 'submit';
      form.append(label(prompt.message, field), send);
      prompts.append(form);
      form.onsubmit = async (event) => {
        event.preventDefault();
        send.disabled = true;
        error();
        try {
          const next = await api(`/api/providers/login/${jobId}`, {
            method: 'POST',
            body: { promptId: prompt.id, value: field.value },
          });
          field.value = '';
          updateJob(next);
        } catch (e) {
          error(e.message);
        } finally {
          send.disabled = false;
        }
      };
    }
  }
  async function poll() {
    const current = generation,
      id = jobId;
    if (!dialog.open || mode !== 'auth' || !id) return;
    try {
      const job = await api(`/api/providers/login/${id}`);
      if (!dialog.open || current !== generation || jobId !== id || mode !== 'auth') return;
      if (['complete', 'error', 'cancelled'].includes(job.status)) {
        jobId = null;
        if (job.status === 'complete') {
          await changed();
          toast('Compte connecté à Prime Agent.');
          await load();
        } else {
          await load();
          error(job.error || 'Connexion annulée.');
        }
        return;
      }
      updateJob(job);
    } catch (e) {
      if (!dialog.open || current !== generation) return;
      error(e.message);
    }
    if (dialog.open && current === generation && mode === 'auth') timer = setTimeout(poll, 900);
  }
  dialog.addEventListener('close', () => {
    ++generation;
    clearTimeout(timer);
    view.replaceChildren();
    error();
  });
  $('providers-close').onclick = $('providers-done').onclick = () => dialog.close();
  document.getElementById('open-provider-settings').onclick = () => {
    if (!allowed()) return;
    dialog.showModal();
    void load();
  };
}
