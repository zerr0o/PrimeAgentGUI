// Mobile PWA push subscription manager (per-device opt-in).
// Generic notifications only; ownership token stays in this device's localStorage
// as an endpoint -> token map (no hash collisions). Never rotate server-side proofless:
// a lost token recovers via browser unsubscribe + fresh subscribe (new endpoint).
import { t as tr, bindText } from './i18n.js';

const TOKEN_MAP_KEY = 'prime-studio.push-tokens';
const LEGACY_TOKEN_PREFIX = 'prime-studio.push-token.';
const FOCUS_BEAT_MS = 20 * 1000;

function b64ToBytes(value) {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function readTokenMap() {
  try {
    const raw = localStorage.getItem(TOKEN_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function storedToken(endpoint) {
  try {
    const token = readTokenMap()[endpoint];
    return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

function storeToken(endpoint, token) {
  try {
    const map = readTokenMap();
    if (token) map[endpoint] = token;
    else delete map[endpoint];
    localStorage.setItem(TOKEN_MAP_KEY, JSON.stringify(map));
    // Drop legacy 32-bit-hash entries (unmappable, superseded by the exact map).
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_TOKEN_PREFIX)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {}
}

async function api(path, { method = 'GET', body, keepalive } = {}) {
  const r = await fetch(path, {
    method,
    keepalive: keepalive || undefined,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(data.error || `push_${r.status}`);
    error.status = r.status;
    throw error;
  }
  return data;
}

function showError(key) {
  const box = document.getElementById('push-error');
  if (!box) return;
  box.hidden = false;
  bindText(box, () => tr(key));
}

function clearError() {
  const box = document.getElementById('push-error');
  if (box) box.hidden = true;
}

function errorKey(error) {
  const message = String(error?.message || '');
  if (/blocked|denied|dismissed|notallowed|permission/i.test(message)) return 'push.blocked';
  if (/unauthorized|not_found|locked/i.test(message)) return 'push.locked';
  return 'push.failed';
}

export function createPushSettings({ getContext } = {}) {
  const $ = (id) => document.getElementById(id);
  let supported = 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;
  let subscription = null;
  let busy = false;
  let focusTimer = 0;

  function render(state = {}) {
    const section = $('push-options');
    if (!section) return;
    // Show only outside the Windows desktop app; desktop keeps its native panel.
    const desktop = window.__PRIME_STUDIO_DESKTOP__ === true;
    section.hidden = desktop || !supported;
    const note = $('push-unsupported');
    if (note) note.hidden = desktop || supported;
    if (!section || section.hidden) return;
    $('push-enable').disabled = busy;
    $('push-questions').disabled = busy || !subscription;
    $('push-turn-complete').disabled = busy || !subscription;
    if (subscription) {
      $('push-enable').checked = true;
      $('push-questions').checked = state.questions !== false;
      $('push-turn-complete').checked = state.turnComplete !== false;
    } else {
      $('push-enable').checked = false;
      $('push-questions').checked = true;
      $('push-turn-complete').checked = true;
    }
  }

  async function current() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function refresh() {
    render();
    if (!supported || window.__PRIME_STUDIO_DESKTOP__ === true) return;
    try {
      subscription = await current();
      if (!subscription) return render();
      const prefs = await api(`/api/push/subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`);
      render(prefs);
      beat(true);
    } catch {
      render();
    }
  }

  async function subscribeBrowser(reg, publicKey) {
    return reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(publicKey),
    });
  }

  async function enable() {
    if (busy) return;
    busy = true;
    clearError();
    render();
    try {
      // iOS Safari requires the permission prompt inside the user gesture, before
      // any async fetch/serviceWorker.ready gap. This must stay the first await.
      if (!('Notification' in window)) throw new Error('push.blocked');
      if (Notification.permission === 'denied') throw new Error('push.blocked');
      if (Notification.permission === 'default') {
        const verdict = await Notification.requestPermission();
        if (verdict !== 'granted') throw new Error('push.blocked');
      }
      const { publicKey } = await api('/api/push/vapid-key');
      const reg = await navigator.serviceWorker.ready;
      subscription = await subscribeBrowser(reg, publicKey);
      const attempt = async (withProof) => {
        const payload = subscription.toJSON();
        const proof = withProof ? storedToken(payload.endpoint) : null;
        return api('/api/push/subscriptions', {
          method: 'POST',
          body: {
            subscription: { endpoint: payload.endpoint, keys: payload.keys },
            questions: $('push-questions')?.checked !== false,
            turnComplete: $('push-turn-complete')?.checked !== false,
            ...(proof ? { token: proof } : {}),
          },
        });
      };
      let result;
      try {
        result = await attempt(true);
      } catch (error) {
        if (String(error?.message || '').includes('unauthorized')) {
          // Lost-token recovery WITHOUT server-side proofless rotation: revoke the
          // browser registration (its endpoint dies with it), then fresh-subscribe.
          // The retry hits a NEW endpoint, so it cannot take over anyone else's row.
          const doomed = subscription.endpoint;
          try {
            await subscription.unsubscribe();
          } catch {}
          storeToken(doomed, null);
          subscription = await subscribeBrowser(reg, publicKey);
          result = await attempt(false);
        } else throw error;
      }
      const payload = subscription.toJSON();
      storeToken(payload.endpoint, result.token);
      const prefs = await api(`/api/push/subscriptions?endpoint=${encodeURIComponent(payload.endpoint)}`);
      render(prefs);
      beat(true);
    } catch (error) {
      try {
        await subscription?.unsubscribe?.().catch(() => {});
      } catch {}
      subscription = null;
      stopBeat();
      render();
      showError(errorKey(error));
    } finally {
      busy = false;
      render();
    }
  }

  async function disable() {
    if (busy) return;
    busy = true;
    clearError();
    try {
      subscription = subscription || (await current().catch(() => null));
      if (subscription) {
        const token = storedToken(subscription.endpoint);
        try {
          await api('/api/push/subscriptions', {
            method: 'DELETE',
            body: { endpoint: subscription.endpoint, token },
          });
        } catch {}
        storeToken(subscription.endpoint, null);
        await subscription.unsubscribe().catch(() => {});
      }
      subscription = null;
      stopBeat();
      render();
    } catch (error) {
      showError(errorKey(error));
    } finally {
      busy = false;
      render();
    }
  }

  async function updatePrefs() {
    if (busy || !subscription) return;
    busy = true;
    clearError();
    try {
      const token = storedToken(subscription.endpoint);
      const result = await api('/api/push/subscriptions', {
        method: 'PATCH',
        body: {
          endpoint: subscription.endpoint,
          token,
          questions: $('push-questions').checked,
          turnComplete: $('push-turn-complete').checked,
        },
      });
      if (result.removed) {
        await subscription.unsubscribe().catch(() => {});
        subscription = null;
        stopBeat();
      }
      render(result.removed ? {} : result);
    } catch (error) {
      showError(errorKey(error));
      await refresh();
    } finally {
      busy = false;
      render();
    }
  }

  // Best-effort foreground lease: while this PWA is visible, tell the server to
  // skip pushes for THIS subscription. Incoming pushes are still always shown.
  async function beat(immediate = false) {
    stopBeat();
    const send = async () => {
      try {
        if (!subscription || document.hidden) return;
        const token = storedToken(subscription.endpoint);
        if (!token) return;
        await api('/api/push/focus', {
          method: 'POST',
          body: { endpoint: subscription.endpoint, token, focused: true },
        });
      } catch {}
    };
    if (immediate) void send();
    focusTimer = window.setInterval(send, FOCUS_BEAT_MS);
  }

  function stopBeat() {
    if (focusTimer) window.clearInterval(focusTimer);
    focusTimer = 0;
  }

  async function clearFocus() {
    try {
      if (!subscription) return;
      const token = storedToken(subscription.endpoint);
      if (!token) return;
      await api(
        '/api/push/focus',
        { method: 'POST', body: { endpoint: subscription.endpoint, token, focused: false } },
      );
    } catch {}
  }

  document.addEventListener('visibilitychange', () => {
    if (!subscription) return;
    // Clear the lease as soon as the PWA hides, so background pushes resume at once.
    if (!document.hidden) beat(true);
    else void clearFocus();
  });
  window.addEventListener('pagehide', () => {
    void clearFocus();
  });

  function bind() {
    if ($('push-enable'))
      $('push-enable').onchange = () => {
        if ($('push-enable').checked) void enable();
        else void disable();
      };
    if ($('push-questions')) $('push-questions').onchange = () => void updatePrefs();
    if ($('push-turn-complete')) $('push-turn-complete').onchange = () => void updatePrefs();
  }
  bind();

  // Deep link from service-worker notificationclick: ?push-session=<id>&push-run=<id>
  async function consumeDeepLink(select) {
    try {
      const params = new URLSearchParams(location.search);
      const sessionId = params.get('push-session') || '';
      const runId = params.get('push-run') || '';
      if (!sessionId && !runId) return false;
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(sessionId || 'x')) return false;
      if (runId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(runId)) return false;
      params.delete('push-session');
      params.delete('push-run');
      history.replaceState(null, '', params.size ? `${location.pathname}?${params}` : location.pathname);
      if (typeof select === 'function' && sessionId) await select(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  // Notificationclick focus path: SW posts {type:'prime-push-open', sessionId, runId}.
  function listenMessages(select) {
    navigator.serviceWorker?.addEventListener?.('message', (event) => {
      const data = event.data;
      if (!data || data.type !== 'prime-push-open') return;
      if (typeof select === 'function' && typeof data.sessionId === 'string') {
        if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(data.sessionId)) void select(data.sessionId);
      }
    });
  }

  return { refresh, enable, disable, updatePrefs, consumeDeepLink, listenMessages, render };
}
