export function createRemoteAccessSettings({ api, isRemote, toast }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('remote-access-dialog'),
    form = $('remote-code-form');
  const fields = ['remote-code', 'remote-code-confirmation'];
  let revision,
    configured = false,
    busy = false,
    generation = 0;
  const showError = (message = '') => {
    $('remote-code-error').textContent = message;
    $('remote-code-error').hidden = !message;
  };
  function refresh() {
    $('remote-code-fields').disabled = busy || !configured;
    $('save-remote-code').disabled =
      busy || !configured || !/^[0-9]{8}$/.test($(fields[0]).value) || !/^[0-9]{8}$/.test($(fields[1]).value);
    $('save-remote-code').textContent = busy ? 'Enregistrement…' : 'Changer le code';
  }
  function clear() {
    form.reset();
    for (const id of fields) $(id).type = 'password';
    revision = undefined;
    configured = false;
    showError();
  }
  dialog.addEventListener('close', () => {
    generation++;
    clear();
  });
  $('show-remote-code').onchange = (event) => {
    for (const id of fields) $(id).type = event.target.checked ? 'text' : 'password';
  };
  for (const id of fields)
    $(id).oninput = () => {
      showError();
      refresh();
    };
  $('open-remote-access').onclick = async () => {
    if (isRemote()) return;
    $('settings-dialog').close();
    clear();
    const turn = ++generation;
    busy = false;
    refresh();
    $('remote-access-status').textContent = 'Chargement de l’accès mobile…';
    dialog.showModal();
    try {
      const data = await api('/api/remote-access');
      if (turn !== generation) return;
      revision = data.revision;
      configured = data.configured;
      $('remote-access-status').textContent = configured
        ? 'Un même code pour le Wi-Fi, Tailscale et la PWA.'
        : 'L’accès mobile n’est pas encore configuré sur ce PC.';
      refresh();
      if (configured) $(fields[0]).focus();
    } catch (error) {
      if (turn !== generation) return;
      $('remote-access-status').textContent = 'Code d’accès indisponible.';
      showError(
        error.status === 404
          ? 'Cette option nécessite un redémarrage du Studio, après la fin des sessions actives.'
          : error.message,
      );
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (isRemote() || busy || !configured) return;
    if (!form.reportValidity()) return;
    if ($(fields[0]).value !== $(fields[1]).value) {
      showError('Les deux codes ne correspondent pas.');
      $(fields[1]).focus();
      return;
    }
    const turn = generation;
    const body = { code: $(fields[0]).value, confirmation: $(fields[1]).value, revision };
    busy = true;
    refresh();
    showError();
    try {
      await api('/api/remote-access/code', { method: 'POST', body });
      if (turn === generation) dialog.close();
      toast('Code modifié. Reconnectez vos appareils avec le nouveau code.');
    } catch (error) {
      if (turn === generation) showError(error.message);
    } finally {
      body.code = body.confirmation = '';
      if (turn === generation) {
        busy = false;
        refresh();
      }
    }
  };
}
