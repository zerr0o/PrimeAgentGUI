import { formatMessage as tr } from '../public/i18n-core.js';
import { lstat, readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
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
      throw new HttpError(500, tr('server.la_configuration_de_l_acces_mobile_est_illisible_elle_a_ete_cons'));
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
      throw new HttpError(400, tr('server.saisissez_deux_fois_le_meme_code_a_8_chiffres'));
    const operation = writes
      .catch(() => {})
      .then(async () => {
        const data = await readConfig();
        if (!data) throw new HttpError(409, tr('server.activez_d_abord_l_acces_mobile_sur_ce_pc'));
        if (data.revision !== input.revision)
          throw new HttpError(
            409,
            tr('server.l_acces_mobile_a_ete_modifie_dans_une_autre_fenetre_rouvrez_ce_p'),
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
            throw new HttpError(
              409,
              tr('server.la_configuration_a_change_rouvrez_ce_panneau_avant_de_reessayer'),
            );
          await rename(temporary, file);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(
            500,
            tr('server.impossible_d_enregistrer_le_nouveau_code_l_ancien_code_reste_uti'),
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
        if (!data) throw new HttpError(409, tr('server.acces_mobile_non_configure'));
        trackGateway(gateway, data.config);
      });
    writes = operation;
    await operation;
  }
  function trackGateway(gateway, config) {
    gateway.setAccessCode(config);
    if (gateways.has(gateway)) return;
    gateways.add(gateway);
    gateway.once('close', () => gateways.delete(gateway));
  }
  // Serialize network changes and PIN rotation under the same revision boundary.
  // A new listener must bind before configuration replaces the working state.
  async function updateConfig({ revision, build, prepare }) {
    const operation = writes
      .catch(() => {})
      .then(async () => {
        const data = await readConfig();
        if ((data?.revision ?? null) !== revision)
          throw new HttpError(
            409,
            tr('server.l_acces_mobile_a_ete_modifie_dans_une_autre_fenetre_rouvrez_ce_p'),
          );
        const config = build(data ? structuredClone(data.config) : null);
        const prepared = await prepare(config, data?.config);
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await mkdir(dataDir, { recursive: true });
          await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          if (((await readConfig())?.revision ?? null) !== revision)
            throw new HttpError(
              409,
              tr('server.la_configuration_a_change_rouvrez_ce_panneau_avant_de_reessayer'),
            );
          await rename(temporary, file);
        } catch (error) {
          await prepared.rollback();
          throw error;
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
        prepared.commit();
      });
    writes = operation;
    await operation;
  }
  return { file, readConfig, get, changeCode, registerGateway, trackGateway, updateConfig };
}
