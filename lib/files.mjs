import { formatMessage as tr } from '../public/i18n-core.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_BYTES = 20 * 1024 * 1024;
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function validateFiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) fail(tr('server.ajoutez_au_maximum_8_fichiers'));
  let total = 0;
  return value.map((file) => {
    if (
      !file ||
      typeof file.name !== 'string' ||
      !file.name.trim() ||
      file.name.length > 240 ||
      /[\x00-\x1f/\\]/.test(file.name)
    )
      fail(tr('server.nom_de_fichier_invalide'));
    if (typeof file.data !== 'string' || file.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4)
      fail(tr('server.limite_10_mo_par_fichier'), 413);
    if (file.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))
      fail(tr('server.fichier_encode_incorrectement'));
    const data = Buffer.from(file.data, 'base64');
    if (data.length > MAX_FILE_BYTES || (total += data.length) > MAX_FILES_BYTES)
      fail(tr('server.limite_10_mo_par_fichier_et_20_mo_de_fichiers_par_message'), 413);
    if (data.toString('base64') !== file.data) fail(tr('server.fichier_encode_incorrectement'));
    return { name: file.name, data: file.data };
  });
}
export function splitFileMessage(text = '') {
  const originalText = text;
  text = text.trimEnd();
  const marker = '\n\n<prime_studio_files>\n';
  const start = text.lastIndexOf(marker);
  if (start < 0 || !text.endsWith('\n</prime_studio_files>')) return { text: originalText, attachments: [] };
  try {
    const files = JSON.parse(text.slice(start + marker.length, -'\n</prime_studio_files>'.length));
    if (
      !Array.isArray(files) ||
      !files.length ||
      files.length > 8 ||
      files.some(
        (file) => !ID.test(file.id) || typeof file.name !== 'string' || !Number.isSafeInteger(file.size),
      )
    )
      throw new Error();
    return {
      text: text.slice(0, start),
      attachments: files.map(({ id, name, size }) => ({ type: 'file', id, name, size })),
    };
  } catch {
    return { text: originalText, attachments: [] };
  }
}
export function appendFileMessage(text, files) {
  return files.length
    ? `${text}\n\n<prime_studio_files>\n${JSON.stringify(files)}\n</prime_studio_files>`
    : text;
}
export function createFileStore(directory) {
  return {
    async save(files) {
      if (!files.length) return [];
      await mkdir(directory, { recursive: true });
      const saved = [];
      for (const file of files) {
        const id = randomUUID();
        // The original name is metadata; it never controls a directory or executable command.
        const suffix = file.name.match(/\.[a-zA-Z0-9]{1,12}$/)?.[0] || '.bin';
        const path = join(directory, id + suffix);
        const data = Buffer.from(file.data, 'base64');
        const record = { id, name: file.name, size: data.length, path };
        await writeFile(path, data, { flag: 'wx', mode: 0o600 });
        await writeFile(join(directory, id + '.meta.json'), JSON.stringify({ ...record, suffix }), {
          flag: 'wx',
          mode: 0o600,
        });
        saved.push(record);
      }
      return saved;
    },
    async read(id) {
      if (!ID.test(id)) fail(tr('server.fichier_introuvable'), 404);
      try {
        const record = JSON.parse(await readFile(join(directory, id + '.meta.json'), 'utf8'));
        if (!/^\.[a-zA-Z0-9]{1,12}$/.test(record.suffix)) throw new Error();
        return { name: record.name, data: await readFile(join(directory, id + record.suffix)) };
      } catch {
        fail(tr('server.fichier_introuvable'), 404);
      }
    },
  };
}
