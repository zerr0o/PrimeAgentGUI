const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_FILE = 4 * 1024 * 1024,
  MAX_TOTAL = 8 * 1024 * 1024;
const source = (image) =>
  TYPES.includes(image?.mimeType) && typeof image.data === 'string'
    ? `data:${image.mimeType};base64,${image.data}`
    : null;
const node = (tag, className, text) => {
  const value = document.createElement(tag);
  value.className = className || '';
  if (text) value.textContent = text;
  return value;
};

export function renderImages(images) {
  const gallery = node('div', 'message-images');
  for (const [index, image] of images.entries()) {
    if (image.type === 'file') {
      const link = node('a', 'message-file', image.name || 'Fichier joint');
      if (/^[a-f0-9-]{36}$/.test(image.id || '')) {
        link.href = `/api/files/${image.id}`;
        link.setAttribute('download', image.name || 'fichier');
      }
      gallery.append(link);
      continue;
    }
    const url = source(image);
    if (!url) {
      gallery.append(node('span', 'attachment-note', 'Image dans la session native'));
      continue;
    }
    const button = node('button', 'message-image');
    button.type = 'button';
    button.setAttribute('aria-label', `Agrandir l’image ${index + 1}`);
    const img = node('img');
    img.src = url;
    img.alt = `Image jointe ${index + 1}`;
    img.loading = 'lazy';
    button.append(img);
    button.onclick = () => {
      const dialog = node('dialog', 'image-viewer');
      const close = node('button', 'image-viewer-close', 'Fermer');
      close.type = 'button';
      const full = node('img');
      full.src = url;
      full.alt = img.alt;
      dialog.setAttribute('aria-label', img.alt);
      dialog.append(close, full);
      document.body.append(dialog);
      close.onclick = () => dialog.close();
      dialog.onclick = (event) => {
        if (event.target === dialog) dialog.close();
      };
      dialog.onclose = () => {
        dialog.remove();
        button.focus();
      };
      dialog.showModal();
    };
    gallery.append(button);
  }
  return gallery;
}

export function createImageComposer({ getContext, onChange, onError }) {
  const form = document.getElementById('composer-form');
  const textarea = document.getElementById('composer');
  const add = node('button', 'attach-image-button');
  add.id = 'attach-images';
  add.type = 'button';
  add.title = 'Ajouter une photo';
  add.setAttribute('aria-label', add.title);
  add.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg>';
  const input = node('input');
  input.id = 'image-files';
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.accept = 'image/*';
  const attach = node('button', 'attach-image-button');
  attach.id = 'attach-files';
  attach.type = 'button';
  attach.title = 'Ajouter une pièce jointe';
  attach.setAttribute('aria-label', attach.title);
  attach.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.9-2.9L15 6.5"/></svg>';
  const fileInput = node('input');
  fileInput.id = 'attachment-files';
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.hidden = true;
  const controls = node('div', 'attachment-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Pièces jointes');
  controls.append(add, attach, input, fileInput);
  const tray = node('div', 'image-draft-tray');
  tray.id = 'image-draft-tray';
  tray.hidden = true;
  const note = node('p', 'image-draft-note');
  note.setAttribute('role', 'status');
  note.hidden = true;
  const inputRow = node('div', 'composer-input-row');
  textarea.before(tray, inputRow);
  inputRow.append(textarea, controls);
  inputRow.after(note);
  const drafts = new Map();
  let currentKey = '',
    signature = '';
  const notify = () => queueMicrotask(onChange);
  const database = new Promise((done, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Stockage des pièces jointes indisponible.'));
    const req = indexedDB.open('prime-studio-images', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts');
    req.onsuccess = () => done(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  async function write(key, entry) {
    const db = await database;
    if (!db) {
      onError(
        new Error('Les pièces jointes restent dans cet onglet ; leur sauvegarde locale est indisponible.'),
      );
      return;
    }
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    if (entry.items.length) store.put(entry.items, key);
    else store.delete(key);
    tx.onerror = () => onError(new Error('Impossible de sauvegarder les pièces jointes du brouillon.'));
  }
  function entry(key = getContext().key) {
    if (!drafts.has(key)) {
      const value = { items: [], revision: 0, pending: 0, loading: true };
      drafts.set(key, value);
      void (async () => {
        try {
          const db = await database;
          if (db) {
            const saved = await new Promise((done, reject) => {
              const req = db.transaction('drafts').objectStore('drafts').get(key);
              req.onsuccess = () => done(req.result);
              req.onerror = () => reject(req.error);
            });
            if (value.revision === 0 && Array.isArray(saved)) value.items = saved;
          }
        } catch {
          onError(new Error('Impossible de relire les pièces jointes du brouillon.'));
        } finally {
          value.loading = false;
          notify();
        }
      })();
    }
    return drafts.get(key);
  }
  const incompatible = () => {
    const context = getContext();
    return (
      entry().items.some((item) => item.type === 'image') &&
      Array.isArray(context.input) &&
      !context.input.includes('image')
    );
  };
  function update() {
    const context = getContext(),
      value = entry(context.key);
    currentKey = context.key;
    add.disabled = attach.disabled = !!context.disabled || context.available === false || value.loading;
    add.title =
      context.available === false
        ? 'Les pièces jointes seront disponibles après la mise à jour du serveur.'
        : 'Ajouter une photo';
    attach.title = context.available === false ? add.title : 'Ajouter une pièce jointe';
    const next = JSON.stringify([
      currentKey,
      value.items.map((image) => image.id),
      value.pending,
      value.loading,
      context.disabled,
      context.available,
      incompatible(),
    ]);
    if (signature === next) return;
    signature = next;
    tray.replaceChildren();
    tray.hidden = !value.items.length;
    for (const item of value.items) {
      const card = node('div', 'image-draft');
      const img = item.type === 'image' ? node('img') : node('span', 'file-draft-name', item.name);
      if (item.type === 'image') {
        img.src = source(item);
        img.alt = item.name;
      }
      const remove = node('button', 'image-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Retirer ${item.name}`);
      remove.disabled = !!context.disabled;
      remove.onclick = () => {
        value.items = value.items.filter((image) => image.id !== item.id);
        value.revision++;
        void write(context.key, value);
        update();
        notify();
      };
      card.title = item.name;
      card.append(img, remove);
      tray.append(card);
    }
    note.textContent =
      value.items.length && context.available === false
        ? 'Brouillon conservé : les pièces jointes attendent la mise à jour du serveur.'
        : incompatible()
          ? 'Ce modèle ne prend pas en charge les images. Choisissez un modèle compatible.'
          : value.pending
            ? 'Préparation des pièces jointes…'
            : value.items.length
              ? `${value.items.length}/8 pièces jointes · images 4 Mo, fichiers 10 Mo`
              : '';
    note.hidden = !note.textContent;
  }
  async function addFiles(files, photosOnly = false) {
    const context = getContext(),
      value = entry(context.key);
    if (context.disabled || context.available === false || value.loading) return;
    value.pending++;
    update();
    notify();
    try {
      for (const file of files) {
        const isImage = TYPES.includes(file.type),
          type = isImage ? 'image' : 'file';
        if (photosOnly && !isImage) {
          onError(
            new Error(
              `${file.name} : choisissez une image PNG, JPEG, GIF ou WebP. Pour les autres formats, utilisez Pièce jointe.`,
            ),
          );
          continue;
        }
        if (file.size > (isImage ? MAX_FILE : 10 * 1024 * 1024)) {
          onError(new Error(`${file.name} : limite de ${isImage ? 4 : 10} Mo.`));
          continue;
        }
        const fits = () =>
          value.items.length < 8 &&
          (!isImage || value.items.filter((item) => item.type === 'image').length < 4) &&
          value.items.filter((item) => item.type === type).reduce((total, item) => total + item.size, 0) +
            file.size <=
            (isImage ? MAX_TOTAL : 20 * 1024 * 1024);
        if (!fits()) {
          onError(
            new Error('Limite : 8 pièces jointes, dont 4 images ; 8 Mo d’images et 20 Mo de fichiers.'),
          );
          break;
        }
        const dataUrl = await new Promise((done, reject) => {
          const reader = new FileReader();
          reader.onload = () => done(reader.result);
          reader.onerror = () => reject(new Error('Impossible de lire ce fichier.'));
          reader.readAsDataURL(file);
        });
        if (isImage) {
          const decoded = new Image();
          decoded.src = dataUrl;
          try {
            await decoded.decode();
          } catch {
            onError(new Error(`${file.name} : image illisible.`));
            continue;
          }
        }
        // Recheck after asynchronous decoding, since another paste may have completed.
        if (!fits()) break;
        value.items.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name || 'Image collée',
          size: file.size,
          type,
          mimeType: file.type,
          data: dataUrl.slice(dataUrl.indexOf(',') + 1),
        });
        value.revision++;
        void write(context.key, value);
      }
    } catch (error) {
      onError(error);
    } finally {
      value.pending--;
      update();
      notify();
    }
  }
  add.onclick = () => input.click();
  attach.onclick = () => fileInput.click();
  input.onchange = () => {
    const files = [...input.files];
    input.value = '';
    void addFiles(files, true);
  };
  fileInput.onchange = () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    void addFiles(files);
  };
  textarea.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  });
  const dropZone = form.closest('.conversation-column') || form;
  dropZone.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      if (!getContext().disabled) form.classList.add('image-drop-target');
    }
  });
  dropZone.addEventListener('dragleave', (event) => {
    if (!dropZone.contains(event.relatedTarget)) form.classList.remove('image-drop-target');
  });
  dropZone.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files.length) {
      event.preventDefault();
      form.classList.remove('image-drop-target');
      void addFiles([...event.dataTransfer.files]);
    }
  });
  return {
    update,
    hasImages: () => entry().items.length > 0,
    blocked: () => {
      const value = entry();
      return (
        value.loading ||
        value.pending > 0 ||
        (value.items.length > 0 && getContext().available === false) ||
        incompatible()
      );
    },
    snapshot: () => {
      const value = entry();
      return {
        key: getContext().key,
        ids: value.items.map((image) => image.id),
        images: value.items
          .filter((item) => item.type === 'image')
          .map(({ type, mimeType, data }) => ({ type, mimeType, data })),
        files: value.items.filter((item) => item.type === 'file').map(({ name, data }) => ({ name, data })),
      };
    },
    accepted(snapshot) {
      const value = entry(snapshot.key);
      value.items = value.items.filter((image) => !snapshot.ids.includes(image.id));
      value.revision++;
      void write(snapshot.key, value);
      update();
      notify();
    },
  };
}
