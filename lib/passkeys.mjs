import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireLock } from '../scripts/launcher-common.mjs';
import { HttpError } from './store.mjs';
import { formatMessage as tr } from '../public/i18n-core.js';
import { validatePwaOrigin } from './pwa.mjs';

export function createPasskeys({ dataDir }) {
  const file = join(dataDir, 'passkeys.json'), pending = new Map(), revoked = new Set();
  const invalid = () => new HttpError(400, tr('passkeys.failed'));
  async function read() {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw invalid();
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.schema !== 1 || !Array.isArray(data.keys) || data.keys.length > 64) throw invalid();
      return data;
    } catch (error) { if (error.code === 'ENOENT') return { schema: 1, keys: [] }; throw error; }
  }
  async function mutate(fn) {
    await mkdir(dataDir, { recursive: true });
    const unlock = await acquireLock({ lock: join(dataDir, 'passkeys.lock') }, { timeout: 5000 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const data = await read(), result = await fn(data);
      await writeFile(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
      await rename(temp, file);
      return result;
    } finally { await unlink(temp).catch(() => {}); await unlock(); }
  }
  const matching = (keys, origin, epoch) => keys.filter(k => k.origin === origin && k.epoch === epoch);
  function remember(value) {
    for (const [id, item] of pending) if (item.expires < Date.now()) pending.delete(id);
    if (pending.size >= 128) throw new HttpError(429, tr('passkeys.retry'));
    const id = randomUUID();
    pending.set(id, { ...value, expires: Date.now() + 120000 });
    return id;
  }
  function consume(id, kind, origin, epoch, binding) {
    const item = pending.get(id);
    pending.delete(id);
    if (!item || item.kind !== kind || item.origin !== origin || item.epoch !== epoch || item.binding !== binding || item.expires < Date.now()) throw invalid();
    return item;
  }
  async function options({ kind, origin, epoch, binding, name }) {
    validatePwaOrigin(origin);
    const keys = matching((await read()).keys, origin, epoch), rpID = new URL(origin).hostname;
    let optionsJSON;
    if (kind === 'register') {
      if (typeof name !== 'string' || !name.trim() || name.length > 80 || keys.length >= 32) throw invalid();
      optionsJSON = await generateRegistrationOptions({ rpName: 'Prime Agent Studio', rpID,
        userID: randomBytes(32), userName: 'Prime Agent Studio', userDisplayName: 'Prime Agent Studio',
        attestationType: 'none', timeout: 120000,
        excludeCredentials: keys.map(k => ({ id: k.id, transports: k.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' } });
    } else {
      if (!keys.length) throw new HttpError(404, tr('passkeys.none'));
      optionsJSON = await generateAuthenticationOptions({ rpID, timeout: 120000, userVerification: 'required',
        allowCredentials: keys.map(k => ({ id: k.id, transports: k.transports })) });
    }
    const id = remember({ kind, origin, epoch, binding, name: name?.trim(), challenge: optionsJSON.challenge });
    return { id, optionsJSON };
  }
  async function verify({ id, kind, origin, epoch, binding, response }) {
    const item = consume(id, kind, origin, epoch, binding);
    const expected = { response, expectedChallenge: item.challenge, expectedOrigin: origin, expectedRPID: new URL(origin).hostname, requireUserVerification: true };
    if (kind === 'register') {
      let result;
      try { result = await verifyRegistrationResponse(expected); } catch { throw invalid(); }
      if (!result.verified || !result.registrationInfo) throw invalid();
      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
      await mutate(data => {
        if (data.keys.length >= 64 || data.keys.some(k => k.id === credential.id)) throw invalid();
        data.keys.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter, transports: credential.transports, origin, epoch, name: item.name,
          deviceType: credentialDeviceType, backedUp: credentialBackedUp, createdAt: new Date().toISOString() });
      });
      return credential.id;
    }
    return mutate(async data => {
      const key = matching(data.keys, origin, epoch).find(k => k.id === response?.id);
      if (!key) throw invalid();
      let result;
      try { result = await verifyAuthenticationResponse({ ...expected, credential: {
        id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')), counter: key.counter, transports: key.transports,
      } }); } catch { throw invalid(); }
      if (!result.verified) throw invalid();
      key.counter = result.authenticationInfo.newCounter;
      key.lastUsedAt = new Date().toISOString();
      return key.id;
    });
  }
  async function list(epoch, origin) {
    return (await read()).keys.filter(k => (!epoch || k.epoch === epoch) && (!origin || k.origin === origin))
      .map(({ id, name, origin, createdAt, lastUsedAt }) => ({ id, name, origin, createdAt, lastUsedAt }));
  }
  async function remove(id) {
    if (typeof id !== 'string' || id.length > 2048) throw invalid();
    await mutate(data => { data.keys = data.keys.filter(k => k.id !== id); });
    for (const callback of revoked) callback(id);
    return { removed: true };
  }
  return { options, verify, list, remove, onRevoked(fn) { revoked.add(fn); return () => revoked.delete(fn); } };
}
