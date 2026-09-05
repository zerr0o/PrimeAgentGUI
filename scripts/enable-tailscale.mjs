import { networkInterfaces } from 'node:os';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT, isDirectInvocation } from './launcher-common.mjs';
import { hashAccessCode, isTailscaleIPv4 } from '../lib/lan.mjs';

export async function enableTailscale({ root = APP_ROOT, interfaces = networkInterfaces() } = {}) {
  const addresses = Object.entries(interfaces)
    .filter(([name]) => /tailscale/i.test(name))
    .flatMap(([, addresses]) => addresses || [])
    .filter((address) => address.family === 'IPv4' && !address.internal && isTailscaleIPv4(address.address));
  const host = addresses[0]?.address;
  if (!host)
    throw new Error(
      'Connectez Tailscale sur ce PC, puis relancez la commande. Aucune interface Tailscale IPv4 active.',
    );
  const directory = join(root, '.local');
  const file = join(directory, 'lan-access.json');
  let config, code;
  try {
    config = JSON.parse(await readFile(file, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(config.codeHash) || !/^[a-f0-9]{32}$/.test(config.salt))
      throw new Error('Le code existant est invalide. La configuration a été conservée.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    code = String(randomInt(10000000, 100000000));
    const salt = randomBytes(16).toString('hex');
    config = { enabled: false, port: 3089, readOnly: false, salt, codeHash: hashAccessCode(code, salt) };
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535)
    throw new Error('Port distant invalide. La configuration a été conservée.');
  config.tailscale = { enabled: true, host };
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, file);
  return {
    url: `http://${host}:${config.port}`,
    codePreserved: !code,
    ...(code ? { code } : {}),
    restartRequired: true,
  };
}

if (isDirectInvocation(import.meta.url)) {
  try {
    console.log(JSON.stringify(await enableTailscale()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
