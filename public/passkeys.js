import { t, bindText } from './i18n.js';

let library;
function webauthn() {
  if (!library) library = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/vendor/passkeys.js';
    script.onload = () => resolve(window.SimpleWebAuthnBrowser);
    script.onerror = () => { library = null; script.remove(); reject(new Error(t('passkeys.failed'))); };
    document.head.append(script);
  });
  return library;
}
async function request(path, body) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || t('passkeys.failed')); return data;
  } finally { clearTimeout(timeout); }
}
const supported = () => window.isSecureContext && !!window.PublicKeyCredential;
const login = document.getElementById('passkey-login');
if (login && supported()) {
  login.hidden = false; bindText(login, () => t('passkeys.login'));
  login.onclick = async () => {
    login.disabled = true; const status = document.getElementById('passkey-login-status');
    bindText(status, () => t('passkeys.waiting'));
    try {
      const browser = await webauthn(), challenge = await request('/lan/passkeys/login-options', {});
      const response = await browser.startAuthentication({ optionsJSON: challenge.optionsJSON });
      await request('/lan/passkeys/login-verify', { id: challenge.id, response });
      location.assign('/');
    } catch (error) { status.textContent = error.name === 'NotAllowedError' ? t('passkeys.cancelled') : error.message; }
    finally { login.disabled = false; }
  };
}

export function createPasskeySettings({ getContext }) {
  const $ = id => document.getElementById('passkey-' + id);
  const dialog = $('dialog'), form = $('form'); let busy = false, deleting;
  async function refresh() {
    const { remote, readOnly } = getContext();
    $('add').hidden = !remote || readOnly || !supported() || location.protocol !== 'https:';
    bindText($('hint'), () => t(remote ? supported() && location.protocol === 'https:' ? 'passkeys.intro' : 'passkeys.https' : 'passkeys.desktop'));
    $('list').replaceChildren();
    try {
      const data = await request(remote ? '/lan/passkeys/list' : '/api/passkeys');
      if (!data.keys.length) bindText($('status'), () => t('passkeys.none')); else $('status').textContent = '';
      for (const key of data.keys) {
        const row = document.createElement('div'); row.className = 'passkey-row';
        const title = document.createElement('span'); title.textContent = key.name;
        row.append(title);
        if (!remote) {
          const remove = document.createElement('button'); remove.className = 'text-button'; remove.type = 'button';
          bindText(remove, () => t('passkeys.revoke')); remove.onclick = () => open(key);
          row.append(remove);
        }
        $('list').append(row);
      }
    } catch (error) { $('status').textContent = error.message; }
  }
  function open(key) {
    deleting = key; form.reset(); $('error').textContent = '';
    $('fields').hidden = $('fields').disabled = !!key;
    bindText($('title'), () => t(key ? 'passkeys.revoke' : 'passkeys.add'));
    bindText($('note'), () => key ? t('passkeys.revokeNote', { name: key.name }) : t('passkeys.registerNote'));
    bindText($('submit'), () => t(key ? 'passkeys.revoke' : 'passkeys.add'));
    dialog.showModal(); (key ? $('cancel') : $('name')).focus();
  }
  $('add').onclick = () => open();
  $('cancel').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true;
    $('submit').disabled = $('cancel').disabled = true; $('error').textContent = '';
    try {
      if (deleting) await request('/api/passkeys/revoke', { id: deleting.id });
      else {
        const browser = await webauthn();
        const challenge = await request('/lan/passkeys/register-options', { name: $('name').value.trim(), code: $('code').value });
        $('code').value = '';
        const response = await browser.startRegistration({ optionsJSON: challenge.optionsJSON });
        await request('/lan/passkeys/register-verify', { id: challenge.id, response });
      }
      dialog.close(); await refresh();
    } catch (error) { $('error').textContent = error.name === 'NotAllowedError' ? t('passkeys.cancelled') : error.message; }
    finally { busy = false; $('code').value = ''; $('submit').disabled = $('cancel').disabled = false; }
  };
  dialog.addEventListener('close', () => { $('code').value = ''; });
  const panel = document.getElementById('settings-panel-remote');
  new MutationObserver(() => { if (!panel.hidden) void refresh(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => { if (document.getElementById('settings-dialog').open && !panel.hidden) void refresh(); }).observe(document.getElementById('settings-dialog'), { attributes: true, attributeFilter: ['open'] });
  return { refresh };
}
