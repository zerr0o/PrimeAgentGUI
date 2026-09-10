import { t, bindText, getLanguage, onLanguageChange } from './i18n.js';

export function createInteractionSettings({ api, getContext, onStudioPreferences }) {
  const $ = (id) => document.getElementById(id);
  const core = window.__PRIME_STUDIO_NOTIFICATIONS__ === true && window.__TAURI__?.core;
  let defaultBusy = false,
    notificationsBusy = false,
    preferences;
  const error = (id, failed) => {
    $(id).hidden = !failed;
    bindText($(id), () => (failed ? t('interactionSettings.saveError') : ''));
  };
  async function refreshDefault() {
    if (defaultBusy) return;
    defaultBusy = true;
    $('default-allow-questions').disabled = true;
    try {
      const result = await api('/api/studio-preferences');
      $('default-allow-questions').checked = result.allowQuestionsByDefault;
      onStudioPreferences(result);
      error('default-questions-error', false);
    } catch {
      error('default-questions-error', true);
    } finally {
      defaultBusy = false;
      $('default-allow-questions').disabled = getContext().remote || getContext().readOnly;
    }
  }
  $('default-allow-questions').onchange = async () => {
    if (defaultBusy || getContext().remote || getContext().readOnly) return;
    defaultBusy = true;
    const control = $('default-allow-questions'),
      value = control.checked;
    control.disabled = true;
    try {
      const result = await api('/api/studio-preferences', {
        method: 'PATCH',
        body: { allowQuestionsByDefault: value },
      });
      onStudioPreferences(result);
      control.checked = result.allowQuestionsByDefault;
      error('default-questions-error', false);
    } catch {
      control.checked = !value;
      error('default-questions-error', true);
    } finally {
      defaultBusy = false;
      control.disabled = getContext().remote || getContext().readOnly;
    }
  };
  const native = () => !!core && !getContext().remote;
  function renderNotifications() {
    for (const [id, key] of [
      ['notify-questions', 'questions'],
      ['notify-turn-complete', 'turnComplete'],
    ]) {
      $(id).checked = preferences?.[key] !== false;
      $(id).disabled = notificationsBusy || !preferences;
    }
  }
  async function refreshNotifications() {
    $('notification-options').hidden = !native();
    $('notifications-desktop-note').hidden = native();
    if (!native() || notificationsBusy) return;
    notificationsBusy = true;
    renderNotifications();
    try {
      preferences = await core.invoke('desktop_notification_preferences');
      error('notifications-error', false);
    } catch {
      error('notifications-error', true);
    } finally {
      notificationsBusy = false;
      renderNotifications();
    }
  }
  for (const [id, key] of [
    ['notify-questions', 'questions'],
    ['notify-turn-complete', 'turnComplete'],
  ]) {
    $(id).onchange = async () => {
      if (!native() || notificationsBusy) return;
      notificationsBusy = true;
      const value = $(id).checked,
        previous = preferences;
      preferences = { ...preferences, [key]: value };
      renderNotifications();
      try {
        preferences = await core.invoke('desktop_notification_preferences', { patch: { [key]: value } });
        error('notifications-error', false);
      } catch {
        preferences = previous;
        error('notifications-error', true);
      } finally {
        notificationsBusy = false;
        renderNotifications();
      }
    };
  }
  const syncLanguage = () => {
    if (native())
      void core
        .invoke('desktop_notification_preferences', {
          patch: { language: getLanguage() },
        })
        .catch(() => {});
  };
  onLanguageChange(syncLanguage);
  syncLanguage();
  return { refreshDefault, refreshNotifications };
}
