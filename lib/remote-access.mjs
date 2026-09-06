import { lstat, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashAccessCode } from './lan.mjs';
import { HttpError } from './store.mjs';

export function createRemoteAccess({ dataDir }) {
  const file = join(dataDir, 'lan-access.json');
  const gateways = new Set();
  let writes = Promise.resolve();
  async function readConfig() {
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error();
      const raw = await readFile(file, 'utf8'),
        config = JSON.parse(raw);
      if (
        !config ||
        Array.isArray(config) ||
        !/^[a-f0-9]{64}$/.test(config.codeHash) ||
        !/^[a-f0-9]{32}$/.test(config.salt)
      )
        throw new Error();
      return { config, revision: createHash('sha256').update(raw).digest('hex') };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new HttpError(500, 'La configuration de l’accès mobile est illisible. Elle a été conservée.');
    }
  }
  async function get() {
    await writes.catch(() => {});
    const data = await readConfig();
    return {
      configured: !!data,
      enabled: !!(
        data?.config.enabled ||
        data?.config.tailscale?.enabled ||
        data?.config.tailscale?.https?.enabled
      ),
      revision: data?.revision ?? null,
    };
  }
  async function changeCode(input) {
    if (
      !input ||
      Object.keys(input).some((key) => !['code', 'confirmation', 'revision'].includes(key)) ||
      typeof input.code !== 'string' ||
      !/^[0-9]{8}$/.test(input.code) ||
      typeof input.confirmation !== 'string' ||
      input.confirmation !== input.code ||
      typeof input.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.revision)
    )
      throw new HttpError(400, 'Saisissez deux fois le même code à 8 chiffres.');
    const operation = writes
      .catch(() => {})
      .then(async () => {
        const data = await readConfig();
        if (!data) throw new HttpError(409, 'Activez d’abord l’accès mobile sur ce PC.');
        if (data.revision !== input.revision)
          throw new HttpError(
            409,
            'L’accès mobile a été modifié dans une autre fenêtre. Rouvrez ce panneau avant de réessayer.',
          );
        const salt = randomBytes(16).toString('hex');
        const credentials = { salt, codeHash: hashAccessCode(input.code, salt) };
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify({ ...data.config, ...credentials }, null, 2) + '\n', {
            flag: 'wx',
            mode: 0o600,
          });
          if ((await readConfig())?.revision !== data.revision)
            throw new HttpError(409, 'La configuration a changé. Rouvrez ce panneau avant de réessayer.');
          await rename(temporary, file);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(
            500,
            'Impossible d’enregistrer le nouveau code. L’ancien code reste utilisable.',
          );
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
        // Synchronous switch across every listener, after persistence succeeds.
        for (const gateway of gateways) gateway.setAccessCode(credentials);
      });
    writes = operation;
    await operation;
    return { updated: true, reconnectRequired: true };
  }
  async function registerGateway(gateway) {
    const operation = writes
      .catch(() => {})
      .then(async () => {
        const data = await readConfig();
        if (!data) throw new HttpError(409, 'Accès mobile non configuré.');
        gateway.setAccessCode(data.config);
        gateways.add(gateway);
        gateway.once('close', () => gateways.delete(gateway));
      });
    writes = operation;
    await operation;
  }
  return { file, readConfig, get, changeCode, registerGateway };
}
