import { t as tr, bindText, bindAttribute } from './i18n.js';

export function bindInlineImages(root, references, { cwd, basePath = '', imageRoot }) {
  const previous = new Map();
  for (const node of imageRoot?.querySelectorAll('[data-image-reference]') || []) {
    const list = previous.get(node.dataset.imageReference) || [];
    list.push(node);
    previous.set(node.dataset.imageReference, list);
  }
  for (const marker of root.querySelectorAll('[data-studio-image]')) {
    const reference = references[Number(marker.dataset.studioImage)];
    if (!reference) {
      marker.remove();
      continue;
    }
    const { href, text } = reference;
    const key = JSON.stringify([cwd, basePath, href, text]);
    const reusable = previous.get(key)?.shift();
    if (reusable) {
      marker.replaceWith(reusable);
      continue;
    }
    const wrapper = document.createElement('span');
    wrapper.className = 'inline-image';
    wrapper.dataset.imageReference = key;
    const caption = text || href.split(/[\\/]/).at(-1) || tr('ui.image_jointe', { value1: 1 });
    const url = new URL('/api/project-files/image', location.origin);
    url.search = new URLSearchParams({ cwd: cwd || '', reference: href, basePath });
    const local = !/^\/\//.test(href) && !/^[a-z][\w+.-]*:/i.test(href.replace(/^[a-z]:[\\/]/i, ''));
    const isFile = /^file:\/\//i.test(href);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inline-image-open';
    bindAttribute(button, 'aria-label', () => tr('images.open', { name: caption }));
    const img = document.createElement('img');
    img.alt = caption;
    img.loading = 'lazy';
    const note = document.createElement('span');
    note.className = 'inline-image-note';
    note.textContent = caption;
    wrapper.append(button, note);
    button.append(img);
    marker.replaceWith(wrapper);
    function unavailable(key) {
      button.hidden = true;
      bindText(note, () => `${tr(key)} · ${caption}`);
      if (!wrapper.querySelector('.inline-image-retry') && (local || isFile)) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'inline-image-retry';
        bindText(retry, () => tr('ui.reessayer'));
        retry.onclick = () => {
          retry.remove();
          button.hidden = false;
          note.textContent = caption;
          img.src = url.pathname + url.search;
        };
        wrapper.append(retry);
      }
    }
    if (!local && !isFile) {
      unavailable('images.localOnly');
      continue;
    }
    img.onerror = async () => {
      let key = 'images.unavailable';
      try {
        const response = await fetch(url.pathname + url.search, { method: 'HEAD', cache: 'no-store' });
        if (response.status === 404) key = 'images.missing';
        else if (response.status === 403) key = 'images.outside';
        else if (response.status === 415) key = 'images.unsupported';
      } catch {
        key = 'images.offline';
      }
      unavailable(key);
    };
    img.src = url.pathname + url.search;
    button.onclick = () => {
      const dialog = document.createElement('dialog');
      dialog.className = 'image-viewer';
      dialog.setAttribute('aria-label', caption);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'image-viewer-close';
      bindText(close, () => tr('ui.fermer'));
      const full = document.createElement('img');
      full.alt = caption;
      full.src = img.src;
      full.onerror = () => {
        dialog.close();
        void img.onerror();
      };
      close.onclick = () => dialog.close();
      dialog.onclick = (event) => {
        if (event.target === dialog) dialog.close();
      };
      dialog.onclose = () => {
        dialog.remove();
        if (button.isConnected) button.focus();
      };
      dialog.append(close, full);
      document.body.append(dialog);
      dialog.showModal();
    };
  }
}
