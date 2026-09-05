import { networkInterfaces } from 'node:os';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT } from './launcher-common.mjs';
import { isPrivateIPv4, hashAccessCode } from '../lib/lan.mjs';

const specified = process.argv[2];
const candidates = Object.entries(networkInterfaces())
  .filter(([name]) => !/(vEthernet|WSL|Virtual|Docker)/i.test(name))
  .flatMap(([, list]) => list)
  .filter((a) => a.family === 'IPv4' && !a.internal && isPrivateIPv4(a.address));
const host = specified || candidates[0]?.address;
if (!host || !candidates.some((a) => a.address === host))
  throw new Error('Aucune adresse de réseau local physique correspondante.');
const code = String(randomInt(10000000, 100000000)),
  salt = randomBytes(16).toString('hex');
const config = {
  enabled: true,
  host,
  port: 3089,
  readOnly: false,
  salt,
  codeHash: hashAccessCode(code, salt),
};
await mkdir(join(APP_ROOT, '.local'), { recursive: true });
await writeFile(join(APP_ROOT, '.local', 'lan-access.json'), JSON.stringify(config, null, 2) + '\n', {
  mode: 0o600,
});
console.log(JSON.stringify({ url: `http://${host}:3089`, code, restartRequired: true }));
