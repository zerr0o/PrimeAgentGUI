const node = (tag, className, text) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
};
const statusLabel = {
  invalid: 'Configuration à corriger',
  configured: 'Configuré',
  disabled: 'Désactivé',
  'missing-env': 'Variable manquante',
  'login-required': 'Connexion requise',
  reserved: 'Nom natif réservé',
};
export function createMcpSettings({ api, toast }) {
  const dialog = node('dialog', 'modal mcp-modal');
  dialog.id = 'mcp-dialog';
  dialog.setAttribute('aria-labelledby', 'mcp-title');
  dialog.innerHTML = `
    <header class="mcp-heading"><div><span class="mcp-eyebrow">OUTILS ET SERVICES</span><h2 id="mcp-title">Connexions MCP</h2></div><button id="mcp-close" class="icon-button" aria-label="Fermer les connexions MCP">×</button></header>
    <div class="mcp-content">
      <p class="mcp-intro">Reliez Prime Agent à vos services et à vos outils locaux. La configuration est partagée par les projets sur ce PC.</p>
      <div id="mcp-error" class="form-error" role="alert" hidden></div>
      <section id="mcp-list-view"><div class="mcp-list-toolbar"><label class="sr-only" for="mcp-search">Rechercher un MCP</label><input id="mcp-search" type="search" placeholder="Rechercher une connexion…"><button id="mcp-add" class="primary-button">Ajouter un MCP</button></div><div id="mcp-list" aria-live="polite"></div></section>
      <form id="mcp-form" hidden>
        <div class="mcp-form-heading"><h3 id="mcp-form-title">Ajouter un MCP</h3><button type="button" id="mcp-back" class="secondary-button">Retour</button></div>
        <div class="mcp-form-grid">
          <label>Nom du serveur<input id="mcp-name" required maxlength="64" placeholder="mon-service" autocomplete="off"></label>
          <label>Connexion<select id="mcp-type"><option value="http">HTTP · service distant</option><option value="stdio">stdio · processus sur le PC</option></select></label>
          <div id="mcp-http" class="mcp-wide mcp-form-grid">
            <label class="mcp-wide">Adresse du serveur<input id="mcp-url" type="url" placeholder="https://exemple.fr/mcp" autocomplete="off"></label>
            <label>Authentification<select id="mcp-auth"><option value="none">Aucune</option><option value="bearer">Jeton par variable d’environnement</option><option value="oauth">Connexion OAuth</option></select></label>
            <label id="mcp-token-row" hidden>Variable contenant le jeton<input id="mcp-token" placeholder="MON_SERVICE_TOKEN" autocomplete="off"></label>
          </div>
          <div id="mcp-stdio" class="mcp-wide mcp-form-grid" hidden>
            <label class="mcp-wide">Exécutable sur le PC<input id="mcp-command" placeholder="node" autocomplete="off"></label>
            <label class="mcp-wide">Arguments · un argument par ligne<textarea id="mcp-args" rows="3" placeholder="C:\\outils\\serveur.js&#10;--stdio" spellcheck="false"></textarea></label>
            <label class="mcp-wide">Dossier de travail · facultatif<input id="mcp-cwd" placeholder="C:\\mes-outils" autocomplete="off"></label>
            <label class="mcp-wide">Variables · NOM_ENFANT=NOM_VARIABLE_DU_PC<textarea id="mcp-env" rows="2" placeholder="TOKEN=MON_SERVICE_TOKEN" spellcheck="false"></textarea></label>
          </div>
        </div>
        <details class="mcp-advanced"><summary>Options avancées</summary>
          <div class="mcp-form-grid">
            <label>Délai de démarrage · ms<input id="mcp-startup" type="number" min="1000" max="300000" step="1000" value="20000"></label>
            <label>Délai par appel · ms<input id="mcp-timeout" type="number" min="1000" max="300000" step="1000" value="60000"></label>
            <label>Accès aux outils<select id="mcp-tools-mode"><option value="all">Tous sauf les outils interdits</option><option value="selected">Seulement la liste autorisée</option></select><textarea id="mcp-enabled-tools" aria-label="Outils autorisés, un par ligne" rows="3" placeholder="Un outil par ligne" spellcheck="false" hidden></textarea><small id="mcp-tools-note" hidden>Une liste vide n’autorise aucun outil.</small></label>
            <label>Outils interdits · un par ligne<textarea id="mcp-disabled-tools" rows="3" spellcheck="false"></textarea></label>
            <label id="mcp-headers-row" class="mcp-wide">En-têtes HTTP · objet JSON<textarea id="mcp-headers" rows="3" spellcheck="false" placeholder='{"X-Service": "valeur"}'></textarea><small>Une valeur null conserve l’en-tête privé existant. Les valeurs enregistrées ne sont pas renvoyées au navigateur.</small></label>
          </div>
        </details>
        <p id="mcp-private-url-note" class="mcp-note" hidden>Les paramètres privés de l’adresse sont conservés tant que vous ne changez pas celle-ci.</p>
        <p class="mcp-note">Enregistrer prépare la connexion. « Tester » démarre une connexion séparée pour découvrir ses outils ; aucun outil métier n’est exécuté.</p>
        <div id="mcp-form-error" class="form-error" role="alert" hidden></div>
        <div class="modal-actions"><button id="mcp-save" class="primary-button" type="submit">Enregistrer</button></div>
      </form>
      <section id="mcp-test-view" hidden><div class="mcp-form-heading"><h3 id="mcp-test-title">Test de connexion</h3><button id="mcp-test-back" class="secondary-button">Retour</button></div><p id="mcp-test-status" role="status"></p><div id="mcp-tools"></div></section>
      <section id="mcp-oauth-view" hidden><h3 id="mcp-oauth-title">Connexion OAuth</h3><p id="mcp-oauth-status" role="status"></p><a id="mcp-oauth-link" class="primary-button" target="_blank" rel="noopener noreferrer" hidden>Autoriser dans le navigateur</a><p class="mcp-note">Sur mobile, après autorisation, le navigateur peut afficher une adresse localhost inaccessible. Copiez cette adresse complète et collez-la ici. Sur le PC, le retour est automatique.</p><form id="mcp-oauth-form"><label for="mcp-oauth-return">Adresse complète de retour</label><input id="mcp-oauth-return" type="url" autocomplete="off" spellcheck="false" placeholder="http://localhost:53700/callback?…" required><div class="modal-actions"><button id="mcp-oauth-cancel" type="button" class="secondary-button">Annuler</button><button type="submit" class="primary-button">Valider le retour</button></div></form></section>
      <section id="mcp-remove-view" hidden><h3 id="mcp-remove-title">Supprimer cette connexion ?</h3><p>La configuration de ce serveur et ses identifiants MCP enregistrés seront retirés. Les autres connexions et les comptes de modèles sont conservés.</p><div class="modal-actions"><button id="mcp-remove-cancel" class="secondary-button">Annuler</button><button id="mcp-remove-confirm" class="primary-button danger-button">Supprimer</button></div></section>
    </div><footer class="mcp-footer">Les nouveaux réglages s’appliquent aux nouvelles sessions. Les sessions déjà en cours continuent avec leurs connexions actuelles.</footer>`;
  document.body.append(dialog);
  const $ = (id) => dialog.querySelector('#' + id);
  let servers = [],
    editing,
    removing,
    oauthJob,
    pollTimer,
    generation = 0;
  function error(message, id = 'mcp-error') {
    $(id).textContent = message || '';
    $(id).hidden = !message;
  }
  function view(name) {
    for (const part of ['list-view', 'form', 'test-view', 'oauth-view', 'remove-view'])
      $('mcp-' + part).hidden = part !== name;
    error('');
    dialog.querySelector('.mcp-content').scrollTop = 0;
  }
  async function load() {
    const data = await api('/api/mcp');
    servers = data.servers || [];
    render();
  }
  function action(label, handler, className = 'secondary-button') {
    const button = node('button', className, label);
    button.type = 'button';
    button.onclick = async () => {
      button.disabled = true;
      try {
        await handler();
      } catch (e) {
        error(e.message);
      } finally {
        button.disabled = false;
      }
    };
    return button;
  }
  function render() {
    const root = $('mcp-list');
    root.replaceChildren();
    const query = $('mcp-search').value.toLocaleLowerCase();
    for (const server of servers.filter((s) => `${s.label} ${s.name}`.toLocaleLowerCase().includes(query))) {
      const card = node('article', 'mcp-card');
      card.dataset.name = server.name;
      const heading = node('div', 'mcp-card-heading'),
        title = node('div');
      title.append(
        node('h3', '', server.label),
        node(
          'p',
          'mcp-transport',
          server.builtin
            ? 'Intégration native · OAuth'
            : server.config.type === 'stdio'
              ? 'Processus local · stdio'
              : 'Service distant · HTTP',
        ),
      );
      heading.append(
        title,
        node(
          'span',
          `mcp-status ${server.status}`,
          server.authenticated && server.status === 'configured'
            ? 'Authentifié'
            : statusLabel[server.status] || server.status,
        ),
      );
      card.append(
        heading,
        node('p', 'mcp-endpoint', server.config.url || server.config.command || 'Configuration invalide'),
      );
      if (server.missingEnv.length)
        card.append(node('p', 'mcp-warning', 'À définir sur le PC : ' + server.missingEnv.join(', ')));
      const buttons = node('div', 'mcp-card-actions');
      if (!['invalid', 'reserved', 'disabled', 'login-required', 'missing-env'].includes(server.status))
        buttons.append(action('Tester', () => test(server)));
      if (server.config.oauth && !['invalid', 'reserved', 'disabled'].includes(server.status))
        buttons.append(action(server.authenticated ? 'Reconnecter' : 'Connecter', () => login(server)));
      if (server.authenticated)
        buttons.append(
          action('Déconnecter', async () => {
            await api('/api/mcp/disconnect', {
              method: 'POST',
              body: { name: server.name, revision: server.revision },
            });
            await load();
          }),
        );
      if (!server.builtin) {
        buttons.append(
          action('Modifier', () => edit(server)),
          action(server.config.enabled === false ? 'Activer' : 'Désactiver', async () => {
            await api('/api/mcp', {
              method: 'PATCH',
              body: {
                name: server.name,
                revision: server.revision,
                enabled: server.config.enabled === false,
              },
            });
            await load();
          }),
          action(
            'Supprimer',
            () => {
              removing = server;
              $('mcp-remove-title').textContent = `Supprimer « ${server.name} » ?`;
              view('remove-view');
            },
            'danger-text',
          ),
        );
      }
      card.append(buttons);
      root.append(card);
    }
    if (!root.children.length)
      root.append(
        node(
          'p',
          'mcp-empty',
          query
            ? 'Aucune connexion ne correspond à votre recherche.'
            : 'Ajoutez votre première connexion MCP.',
        ),
      );
  }
  function transport() {
    const http = $('mcp-type').value === 'http';
    $('mcp-http').hidden = !http;
    $('mcp-stdio').hidden = http;
    $('mcp-headers-row').hidden = !http;
    $('mcp-token-row').hidden = $('mcp-auth').value !== 'bearer';
    $('mcp-token').required = http && $('mcp-auth').value === 'bearer';
    $('mcp-url').required = http;
    $('mcp-command').required = !http;
  }
  function edit(server) {
    editing = server;
    $('mcp-form').reset();
    const c = server?.config || {};
    $('mcp-name').value = server?.name || '';
    $('mcp-name').disabled = !!server;
    $('mcp-form-title').textContent = server ? `Modifier ${server.name}` : 'Ajouter un MCP';
    $('mcp-type').value = c.type === 'stdio' ? 'stdio' : 'http';
    $('mcp-url').value = c.url || '';
    $('mcp-command').value = c.command || '';
    $('mcp-args').value = (c.args || []).join('\n');
    $('mcp-cwd').value = c.cwd || '';
    $('mcp-env').value = Object.entries(c.env || {})
      .map(([key, ref]) => `${key}=${ref.env}`)
      .join('\n');
    $('mcp-auth').value = c.oauth ? 'oauth' : c.bearerTokenEnvVar ? 'bearer' : 'none';
    $('mcp-token').value = c.bearerTokenEnvVar || '';
    $('mcp-startup').value = c.startupTimeoutMs ?? 20000;
    $('mcp-timeout').value = c.callTimeoutMs ?? 60000;
    $('mcp-enabled-tools').value = (c.enabledTools || []).join('\n');
    $('mcp-tools-mode').value = Array.isArray(c.enabledTools) ? 'selected' : 'all';
    toolsMode();
    $('mcp-disabled-tools').value = (c.disabledTools || []).join('\n');
    $('mcp-headers').value = c.headers ? JSON.stringify(c.headers, null, 2) : '';
    $('mcp-private-url-note').hidden = !c.privateUrlParameters;
    error('', 'mcp-form-error');
    transport();
    view('form');
    $('mcp-name').disabled ? $('mcp-type').focus() : $('mcp-name').focus();
  }
  const lines = (id) =>
    $(id)
      .value.split(/\r?\n/)
      .filter((line) => line.trim());
  $('mcp-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = $('mcp-save');
    button.disabled = true;
    error('', 'mcp-form-error');
    try {
      const config = {
        type: $('mcp-type').value,
        enabled: editing?.config.enabled !== false,
        startupTimeoutMs: Number($('mcp-startup').value),
        callTimeoutMs: Number($('mcp-timeout').value),
      };
      if ($('mcp-tools-mode').value === 'selected') config.enabledTools = lines('mcp-enabled-tools');
      if (lines('mcp-disabled-tools').length) config.disabledTools = lines('mcp-disabled-tools');
      if (config.type === 'http') {
        config.url = $('mcp-url').value.trim();
        if ($('mcp-auth').value === 'oauth') config.oauth = true;
        if ($('mcp-auth').value === 'bearer') config.bearerTokenEnvVar = $('mcp-token').value.trim();
        if ($('mcp-headers').value.trim()) {
          try {
            config.headers = JSON.parse($('mcp-headers').value);
          } catch {
            throw new Error('Les en-têtes doivent être un objet JSON valide.');
          }
        }
      } else {
        config.command = $('mcp-command').value.trim();
        config.args = lines('mcp-args');
        if ($('mcp-cwd').value.trim()) config.cwd = $('mcp-cwd').value.trim();
        config.env = Object.create(null);
        for (const line of lines('mcp-env')) {
          const index = line.indexOf('=');
          if (index < 1) throw new Error('Chaque variable utilise NOM_ENFANT=NOM_VARIABLE_DU_PC.');
          const key = line.slice(0, index).trim();
          if (Object.hasOwn(config.env, key)) throw new Error('Une variable est déclarée plusieurs fois.');
          config.env[key] = { env: line.slice(index + 1).trim() };
        }
      }
      await api('/api/mcp', {
        method: 'POST',
        body: { name: $('mcp-name').value.trim(), revision: editing?.revision, config },
      });
      await load();
      view('list-view');
      toast('Configuration MCP enregistrée.');
    } catch (e) {
      error(e.message, 'mcp-form-error');
    } finally {
      button.disabled = false;
    }
  };
  async function test(server) {
    view('test-view');
    const current = ++generation;
    $('mcp-test-title').textContent = `Tester ${server.name}`;
    $('mcp-test-status').textContent = 'Connexion et découverte des outils…';
    $('mcp-tools').replaceChildren();
    try {
      const result = await api('/api/mcp/test', {
        method: 'POST',
        body: { name: server.name, revision: server.revision },
      });
      if (current !== generation || !dialog.open) return;
      $('mcp-test-status').textContent =
        `Connexion réussie · ${result.total} outil${result.total > 1 ? 's' : ''} disponible${result.total > 1 ? 's' : ''}`;
      for (const tool of result.tools || []) {
        const item = node('details', 'mcp-tool');
        item.append(
          node('summary', '', tool.name),
          node('p', '', tool.description || 'Aucune description'),
          node('pre', '', JSON.stringify(tool.inputSchema, null, 2)),
        );
        $('mcp-tools').append(item);
      }
    } catch (e) {
      if (current === generation && dialog.open) $('mcp-test-status').textContent = e.message;
    }
  }
  async function cancelLogin() {
    generation++;
    clearTimeout(pollTimer);
    if (oauthJob) {
      const id = oauthJob.id;
      oauthJob = undefined;
      await api('/api/mcp/login/' + id, { method: 'DELETE' }).catch(() => {});
    }
  }
  async function login(server) {
    await cancelLogin();
    const current = generation;
    view('oauth-view');
    $('mcp-oauth-title').textContent = `Connecter ${server.label}`;
    $('mcp-oauth-status').textContent = 'Préparation de la connexion…';
    $('mcp-oauth-link').hidden = true;
    $('mcp-oauth-form').reset();
    try {
      const job = await api('/api/mcp/login', {
        method: 'POST',
        body: { name: server.name, revision: server.revision },
      });
      if (current !== generation || !dialog.open) {
        await api('/api/mcp/login/' + job.id, { method: 'DELETE' }).catch(() => {});
        return;
      }
      oauthJob = job;
      await poll();
    } catch (e) {
      error(e.message);
    }
  }
  async function poll() {
    if (!oauthJob || !dialog.open) return;
    const id = oauthJob.id;
    try {
      const data = await api('/api/mcp/login/' + id);
      if (oauthJob?.id !== id) return;
      oauthJob = data;
      if (data.status === 'waiting') {
        $('mcp-oauth-status').textContent = 'Autorisez Prime Agent dans le navigateur.';
        $('mcp-oauth-link').href = data.url;
        $('mcp-oauth-link').hidden = false;
      }
      if (data.status === 'complete') {
        oauthJob = undefined;
        await load();
        view('list-view');
        toast('Connexion MCP autorisée.');
        return;
      }
      if (['error', 'cancelled'].includes(data.status)) {
        oauthJob = undefined;
        $('mcp-oauth-link').hidden = true;
        error(data.error || 'Connexion annulée.');
        $('mcp-oauth-status').textContent = 'La connexion n’a pas abouti.';
        return;
      }
      pollTimer = setTimeout(poll, 1000);
    } catch (e) {
      error(e.message);
    }
  }
  $('mcp-oauth-form').onsubmit = async (event) => {
    event.preventDefault();
    if (!oauthJob) return;
    try {
      await api('/api/mcp/login/complete', {
        method: 'POST',
        body: { id: oauthJob.id, url: $('mcp-oauth-return').value },
      });
      $('mcp-oauth-return').value = '';
      error('');
    } catch (e) {
      error(e.message);
    }
  };
  $('mcp-oauth-cancel').onclick = async () => {
    await cancelLogin();
    view('list-view');
  };
  $('mcp-remove-confirm').onclick = async () => {
    const button = $('mcp-remove-confirm');
    button.disabled = true;
    try {
      await api('/api/mcp', { method: 'DELETE', body: { name: removing.name, revision: removing.revision } });
      await load();
      view('list-view');
    } catch (e) {
      error(e.message);
    } finally {
      button.disabled = false;
    }
  };
  $('mcp-remove-cancel').onclick = $('mcp-back').onclick = () => view('list-view');
  $('mcp-test-back').onclick = () => {
    generation++;
    view('list-view');
  };
  $('mcp-add').onclick = () => edit();
  $('mcp-search').oninput = render;
  $('mcp-type').onchange = $('mcp-auth').onchange = transport;
  function toolsMode() {
    const limited = $('mcp-tools-mode').value === 'selected';
    $('mcp-enabled-tools').hidden = !limited;
    $('mcp-tools-note').hidden = !limited;
  }
  $('mcp-tools-mode').onchange = toolsMode;
  $('mcp-close').onclick = () => dialog.close();
  dialog.onclose = () => {
    generation++;
    void cancelLogin();
    document.getElementById('open-settings').focus({ preventScroll: true });
  };
  document.getElementById('open-mcp-settings').onclick = async () => {
    document.getElementById('settings-dialog').close();
    dialog.showModal();
    view('list-view');
    $('mcp-list').textContent = 'Chargement des connexions…';
    try {
      await load();
    } catch (e) {
      error(e.message);
    }
  };
}
