import { t, bindText, onLanguageChange } from './i18n.js';

export function createDesktopUpdates({ getContext }) {
  const $ = (id) => document.getElementById('studio-update-' + id);
  const core = window.__PRIME_STUDIO_DESKTOP__ === true && window.__TAURI__?.core;
  let busy = false,
    snapshot,
    version,
    statusKey = 'updates.idle',
    statusParams;
  const status = (key, params) => {
    statusKey = key;
    statusParams = params;
    bindText($('status'), () => t(statusKey, statusParams));
  };
  const failure = (error) => {
    $('error').hidden = !error;
    const key = [
      'server_not_managed',
      'server_port_occupied',
      'server_version_mismatch',
      'download_failed',
      'install_failed',
      'check_failed',
      'update_busy',
    ].includes(String(error))
      ? String(error)
      : 'failed';
    const message = `updates.${key}`;
    bindText($('error'), () => (error ? t(message) : ''));
  };
  function controls() {
    $('check').disabled = $('install').disabled = $('restart-after').disabled = busy;
    $('restart').disabled = busy || !snapshot?.managed;
    $('native').setAttribute('aria-busy', String(busy));
  }
  async function refresh() {
    const native = Boolean(core) && !getContext().remote;
    $('browser').hidden = native;
    $('native').hidden = !native;
    if (!native) return;
    try {
      snapshot = await core.invoke('desktop_update_status');
      $('app-version').textContent = snapshot.appVersion;
      $('server-version').textContent = snapshot.version || t('updates.stopped');
      const key = !snapshot.managed
        ? 'updates.unmanaged'
        : !snapshot.running
          ? 'updates.stopped_note'
          : snapshot.version !== snapshot.appVersion
            ? 'updates.pending'
            : 'updates.server_current';
      bindText($('server-note'), () => t(key));
      const count = snapshot.activeRuns;
      bindText($('agents'), () => t(count ? 'updates.agents' : 'updates.no_agents', { count }));
      controls();
      return snapshot;
    } catch (error) {
      snapshot = undefined;
      controls();
      failure(error);
      throw error;
    }
  }
  function confirm(kind, count) {
    const dialog = $('confirm');
    bindText($('confirm-title'), () =>
      t(kind === 'interrupt' ? 'updates.interrupt_title' : 'updates.install_busy_title'),
    );
    bindText($('confirm-note'), () =>
      t(kind === 'interrupt' ? 'updates.interrupt_note' : 'updates.install_busy_note', { count }),
    );
    bindText($('proceed'), () => t(kind === 'interrupt' ? 'updates.interrupt' : 'updates.install'));
    return new Promise((resolve) => {
      dialog.returnValue = '';
      $('cancel').onclick = () => dialog.close('cancel');
      $('proceed').onclick = () => dialog.close('proceed');
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'proceed'), { once: true });
      dialog.showModal();
      $('cancel').focus();
    });
  }
  $('check').onclick = async () => {
    if (busy) return;
    busy = true;
    controls();
    failure();
    version = undefined;
    $('install').hidden = $('options').hidden = $('notes').hidden = true;
    status('updates.checking');
    try {
      const update = await core.invoke('desktop_update_check');
      version = update.available ? update.version : undefined;
      status(version ? 'updates.available' : 'updates.current', { version });
      $('install').hidden = $('options').hidden = !version;
      $('notes-body').textContent = update.notes || '';
      $('notes').hidden = !version || !update.notes;
      await refresh();
    } catch (error) {
      status('updates.idle');
      failure(error);
    } finally {
      busy = false;
      controls();
    }
  };
  $('install').onclick = async () => {
    if (busy || !version) return;
    busy = true;
    controls();
    failure();
    try {
      const current = await refresh();
      if (current.activeRuns && !(await confirm('install_busy', current.activeRuns))) return;
      $('progress').hidden = false;
      $('progress').removeAttribute('value');
      status('updates.downloading');
      const onEvent = new core.Channel();
      onEvent.onmessage = ({ stage, percent }) => {
        status(
          'updates.' +
            (stage === 'downloading' ? 'downloading' : stage === 'verifying' ? 'verifying' : 'installing'),
        );
        if (stage === 'downloading' && percent != null) $('progress').value = percent;
        else $('progress').removeAttribute('value');
      };
      await core.invoke('desktop_update_install', {
        version,
        onEvent,
        restartServer: $('restart-after').checked,
      });
    } catch (error) {
      $('progress').hidden = true;
      failure(error);
    } finally {
      busy = false;
      controls();
    }
  };
  $('restart').onclick = async () => {
    if (busy) return;
    busy = true;
    controls();
    failure();
    try {
      const current = await refresh();
      if (!current.managed) return;
      let force = false;
      if (current.activeRuns) {
        if (!(await confirm('interrupt', current.activeRuns))) return;
        force = true;
      }
      status('updates.restarting');
      const result = await core.invoke('desktop_server_restart', { force });
      if (result.reason === 'agents_running') {
        status('updates.agents_changed');
        await refresh();
      } else if (result.restarted) status('updates.restarted');
    } catch (error) {
      failure(error);
      status('updates.idle');
    } finally {
      busy = false;
      controls();
    }
  };
  status('updates.idle');
  onLanguageChange(() => {
    if (!$('native').hidden) void refresh().catch(() => {});
  });
  return { refresh: () => refresh().catch(() => {}) };
}
