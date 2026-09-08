const messages = {
  fr: {
    eyebrow: 'VOTRE APPLICATION DE BUREAU',
    title: 'Votre espace de travail, prêt à vous suivre.',
    description:
      'Retrouvez vos projets et vos agents dans une fenêtre dédiée. Le Studio démarre pour vous, en arrière-plan.',
    startup: 'Démarrer avec Windows',
    startupNote: 'Disponible dès votre connexion, sans ouvrir de fenêtre.',
    import: 'Reprendre une installation existante',
    importNote: 'Conservez vos projets, pièces jointes et accès distants.',
    imported: 'Les données de cette application sont déjà initialisées.',
    start: 'Ouvrir le Studio',
    footer: 'Fermer la fenêtre laisse les agents travailler sur ce PC.',
    progress: 'Préparation du Studio…',
    retry: 'Réessayer',
    logs: 'Ouvrir les journaux',
    settingsTitle: 'Réglages de l’application.',
    settingsNote: 'Choisissez comment le Studio vous accompagne sur ce PC.',
    connectingTitle: 'Votre espace se prépare.',
    connectingNote: 'Nous retrouvons le serveur actif ou le démarrons pour vous.',
    failure: 'Le Studio n’a pas pu démarrer.',
    noBridge: 'Ouvrez cette page dans l’application Prime Agent Studio.',
    selected: 'Installation sélectionnée : ',
    autostartError: 'Le démarrage avec Windows n’a pas pu être modifié.',
    updates: 'Mises à jour',
    updateIdle: 'Recherchez les nouvelles versions publiées sur GitHub.',
    updateCheck: 'Vérifier les mises à jour',
    updateChecking: 'Recherche d’une nouvelle version…',
    updateCurrent: 'Vous utilisez la dernière version publiée.',
    updateAvailable: 'La version {version} est disponible.',
    updateInstall: 'Installer et relancer',
    updateNotes: 'Nouveautés de cette version',
    updateImpact:
      'L’application se relancera. Vos agents continuent ; le serveur actif garde sa version jusqu’à son prochain démarrage.',
    updateDownloading: 'Téléchargement',
    updateVerifying: 'Vérification de la signature…',
    updateInstalling: 'Installation et relance de l’application…',
    updateCheckFailed:
      'Impossible de consulter les mises à jour. Vérifiez votre connexion ou réessayez plus tard.',
    updateDownloadFailed:
      'Le téléchargement ou sa signature n’a pas pu être validé. Aucune mise à jour installée.',
    updateInstallFailed: 'L’installation n’a pas pu démarrer. Vous pouvez réessayer.',
  },
  en: {
    eyebrow: 'YOUR DESKTOP APPLICATION',
    title: 'Your workspace, ready when you are.',
    description: 'Your projects and agents in a dedicated window. Studio starts for you, in the background.',
    startup: 'Start with Windows',
    startupNote: 'Ready when you sign in, without opening a window.',
    import: 'Use an existing installation',
    importNote: 'Keep your projects, attachments and remote access.',
    imported: 'This application’s data has already been initialized.',
    start: 'Open Studio',
    footer: 'Closing the window leaves agents working on this PC.',
    progress: 'Preparing Studio…',
    retry: 'Try again',
    logs: 'Open logs',
    settingsTitle: 'Application settings.',
    settingsNote: 'Choose how Studio accompanies you on this PC.',
    connectingTitle: 'Preparing your workspace.',
    connectingNote: 'We are finding the running server or starting it for you.',
    failure: 'Studio could not start.',
    noBridge: 'Open this page in the Prime Agent Studio application.',
    selected: 'Selected installation: ',
    autostartError: 'Could not change the start with Windows setting.',
    updates: 'Updates',
    updateIdle: 'Check for new versions published on GitHub.',
    updateCheck: 'Check for updates',
    updateChecking: 'Checking for a new version…',
    updateCurrent: 'You are using the latest published version.',
    updateAvailable: 'Version {version} is available.',
    updateInstall: 'Install and restart',
    updateNotes: 'What’s new',
    updateImpact:
      'The app will restart. Your agents continue; the running server keeps its version until its next start.',
    updateDownloading: 'Downloading',
    updateVerifying: 'Verifying the signature…',
    updateInstalling: 'Installing and restarting the app…',
    updateCheckFailed: 'Could not check for updates. Check your connection or try again later.',
    updateDownloadFailed: 'The download or its signature could not be verified. No update was installed.',
    updateInstallFailed: 'The installer could not start. You can try again.',
  },
};
const language = navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en',
  t = messages[language],
  $ = (id) => document.getElementById(id);
document.documentElement.lang = language;
const settings = new URLSearchParams(location.search).has('settings');
document.body.classList.toggle('app-settings', settings);
for (const [id, key] of Object.entries({
  eyebrow: 'eyebrow',
  title: settings ? 'settingsTitle' : 'title',
  description: settings ? 'settingsNote' : 'description',
  'startup-label': 'startup',
  'startup-note': 'startupNote',
  import: 'import',
  'import-note': 'importNote',
  start: 'start',
  footer: 'footer',
  'progress-text': 'progress',
  logs: 'logs',
  'update-heading': 'updates',
  'update-status': 'updateIdle',
  'update-check': 'updateCheck',
  'update-install': 'updateInstall',
  'update-notes-label': 'updateNotes',
  'update-impact': 'updateImpact',
}))
  $(id).textContent = t[key];
const invoke = window.__TAURI__?.core?.invoke;
let updateBusy = false,
  availableVersion;
function updateStatus(message, error = false) {
  $('update-status').textContent = message;
  $('update-status').classList.toggle('failed', error);
}
$('update-check').onclick = async () => {
  if (updateBusy) return;
  updateBusy = true;
  availableVersion = undefined;
  $('update-check').disabled = true;
  $('update-install').hidden = true;
  $('update-notes').hidden = true;
  $('update-impact').hidden = true;
  updateStatus(t.updateChecking);
  try {
    const update = await invoke('desktop_update_check');
    if (update.available) {
      availableVersion = update.version;
      updateStatus(t.updateAvailable.replace('{version}', update.version));
      $('update-install').hidden = false;
      $('update-impact').hidden = false;
      $('update-notes-body').textContent = update.notes || '';
      $('update-notes').hidden = !update.notes;
    } else updateStatus(t.updateCurrent);
  } catch {
    updateStatus(t.updateCheckFailed, true);
  } finally {
    updateBusy = false;
    $('update-check').disabled = false;
  }
};
$('update-install').onclick = async () => {
  if (updateBusy || !availableVersion) return;
  updateBusy = true;
  $('update-check').disabled = true;
  $('update-install').disabled = true;
  $('start').disabled = true;
  $('update-progress').hidden = false;
  $('update-progress').removeAttribute('value');
  updateStatus(t.updateDownloading + '…');
  try {
    const onEvent = new window.__TAURI__.core.Channel();
    onEvent.onmessage = ({ stage, percent }) => {
      if (stage === 'downloading') {
        updateStatus(t.updateDownloading + (percent == null ? '…' : ` · ${percent} %`));
        if (percent != null) $('update-progress').value = percent;
      } else {
        updateStatus(stage === 'verifying' ? t.updateVerifying : t.updateInstalling);
        $('update-progress').removeAttribute('value');
      }
    };
    await invoke('desktop_update_install', { version: availableVersion, onEvent });
  } catch (error) {
    updateStatus(error === 'install_failed' ? t.updateInstallFailed : t.updateDownloadFailed, true);
    $('update-progress').hidden = true;
    $('update-check').disabled = false;
    $('update-install').disabled = false;
    $('start').disabled = false;
    updateBusy = false;
  }
};
let busy = false;
function showError(value) {
  $('error').textContent = value;
  $('error').hidden = !value;
  $('logs').hidden = !value;
}
async function start() {
  if (busy) return;
  busy = true;
  showError('');
  $('start').disabled = true;
  $('import').disabled = true;
  $('progress').hidden = false;
  try {
    await invoke('desktop_start');
    if (settings) {
      $('progress').hidden = true;
      $('start').disabled = false;
    }
  } catch (error) {
    $('progress').hidden = true;
    $('choices').hidden = false;
    $('title').textContent = t.failure;
    showError(String(error));
    $('start').textContent = t.retry;
    $('start').disabled = false;
    $('start').focus();
  } finally {
    busy = false;
    $('import').disabled = false;
  }
}
$('start').onclick = start;
$('logs').onclick = async () => {
  try {
    await invoke('desktop_logs');
  } catch (error) {
    showError(String(error));
  }
};
$('autostart').onchange = async () => {
  const input = $('autostart');
  input.disabled = true;
  try {
    await invoke('desktop_autostart', { enabled: input.checked });
    showError('');
  } catch {
    input.checked = !input.checked;
    showError(t.autostartError);
  } finally {
    input.disabled = false;
  }
};
$('import').onclick = async () => {
  const button = $('import');
  button.disabled = true;
  try {
    const selected = await invoke('desktop_choose_legacy');
    if (selected) {
      $('source').textContent = t.selected + selected;
      $('source').hidden = false;
      showError('');
    }
  } catch (error) {
    showError(String(error));
  } finally {
    button.disabled = false;
  }
};
(async () => {
  if (!invoke) {
    showError(t.noBridge);
    return;
  }
  try {
    const state = await invoke('desktop_state');
    $('app-version').textContent = `v${state.version}`;
    $('updates').hidden = !settings;
    $('autostart').checked = state.autostart;
    $('start').disabled = false;
    if (state.imported) {
      $('import').hidden = true;
      $('import-note').textContent = t.imported;
    } else if (state.legacyRoot) {
      $('source').hidden = false;
      $('source').textContent = t.selected + state.legacyRoot;
    }
    if ((state.started || new URLSearchParams(location.search).has('background')) && !settings) {
      $('title').textContent = t.connectingTitle;
      $('description').textContent = t.connectingNote;
      await start();
    } else $('choices').hidden = false;
  } catch (error) {
    showError(String(error));
  }
})();
