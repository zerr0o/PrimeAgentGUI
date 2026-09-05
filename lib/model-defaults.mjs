import { chmod, copyFile, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { HttpError } from './store.mjs';

const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const MODEL_ID = /^[^\s\x00-\x1f\x7f]{1,300}$/u;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

function cleanSelection(selection) {
  if (
    !record(selection) ||
    Object.keys(selection).some((key) => !['provider', 'id'].includes(key)) ||
    typeof selection.provider !== 'string' ||
    !PROVIDER_ID.test(selection.provider) ||
    FORBIDDEN_KEYS.has(selection.provider) ||
    typeof selection.id !== 'string' ||
    !MODEL_ID.test(selection.id)
  )
    throw new HttpError(400, 'Sélection de modèle invalide.');
  return { provider: selection.provider, id: selection.id };
}

export function createModelDefaultsStore({ agentHome } = {}) {
  if (!agentHome) throw new TypeError('agentHome est requis.');
  const file = join(agentHome, 'settings.json'),
    backupFile = join(agentHome, 'settings.json.prime-studio.bak');
  let writes = Promise.resolve();

  async function readSettings() {
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SETTINGS_BYTES)
        throw new HttpError(500, 'Le fichier settings.json est inaccessible ou trop volumineux.');
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (!record(value)) throw new Error();
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        'Le fichier settings.json contient un JSON invalide. Corrigez-le avant de continuer.',
      );
    }
  }

  async function saveSettings(settings) {
    await mkdir(agentHome, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const existing = await lstat(file).catch(() => null);
      if (existing && (!existing.isFile() || existing.isSymbolicLink()))
        throw new HttpError(500, 'Le fichier settings.json doit être un fichier normal.');
      if (existing) {
        const backup = await lstat(backupFile).catch(() => null);
        if (backup && (!backup.isFile() || backup.isSymbolicLink()))
          throw new HttpError(500, 'La sauvegarde settings.json doit être un fichier normal.');
        await copyFile(file, backupFile);
        await chmod(backupFile, 0o600).catch(() => {});
      }
      await writeFile(temp, JSON.stringify(settings, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temp, file);
      await chmod(file, 0o600).catch(() => {});
    } catch (error) {
      await unlink(temp).catch(() => {});
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        500,
        'Impossible d’enregistrer settings.json. La configuration précédente est conservée.',
      );
    }
  }

  function mutate(operation) {
    const job = writes
      .catch(() => {})
      .then(async () => {
        const settings = await readSettings();
        operation(settings);
        await saveSettings(settings);
      });
    writes = job;
    return job;
  }

  async function get() {
    await writes.catch(() => {});
    const settings = await readSettings(),
      provider = typeof settings.defaultProvider === 'string' ? settings.defaultProvider : '',
      model = typeof settings.defaultModel === 'string' ? settings.defaultModel : '';
    return {
      mainModel: provider && model ? `${provider}/${model}` : '',
      subagents: {
        mode: 'inherit',
        configurable: false,
      },
    };
  }

  async function set(selection) {
    const value = selection == null ? null : cleanSelection(selection);
    await mutate((settings) => {
      if (!value) {
        delete settings.defaultProvider;
        delete settings.defaultModel;
        return;
      }
      settings.defaultProvider = value.provider;
      settings.defaultModel = value.id;
      const selector = `${value.provider}/${value.id}`,
        recent = Array.isArray(settings.recentModels)
          ? settings.recentModels.filter((item) => typeof item === 'string' && item !== selector)
          : [];
      settings.recentModels = [selector, ...recent].slice(0, 20);
    });
    return get();
  }

  return { file, backupFile, get, set };
}
