import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.desktop-build'),
  studio = join(output, 'studio');
if (dirname(output) !== root || !output.endsWith('.desktop-build'))
  throw new Error('Unexpected build directory');
await rm(output, { recursive: true, force: true });
await mkdir(studio, { recursive: true });
for (const name of [
  'server.mjs',
  'index.html',
  'package.json',
  'package-lock.json',
  'LICENSE',
  'lib',
  'public',
  'assets',
  'runtime',
])
  await cp(join(root, name), join(studio, name), {
    recursive: true,
    filter: (path) => !path.includes('__pycache__') && !path.endsWith('.pyc'),
  });
await mkdir(join(studio, 'scripts'));
for (const name of ['start-server.mjs', 'launcher-common.mjs', 'desktop-start.mjs'])
  await cp(join(root, 'scripts', name), join(studio, 'scripts', name));
const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
execFileSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: studio,
  windowsHide: true,
  stdio: 'inherit',
});
await cp(process.execPath, join(output, 'node.exe'));
const nodeLicense = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
if (!nodeLicense.ok) throw new Error('Cannot fetch the license for the bundled Node version');
await writeFile(join(output, 'NODE-LICENSE'), await nodeLicense.text());
const hash = createHash('sha256');
async function fingerprint(folder) {
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await fingerprint(path);
    else {
      hash.update(relative(output, path).replaceAll('\\', '/'));
      hash.update(await readFile(path));
    }
  }
}
await fingerprint(output);
const pkg = JSON.parse(await readFile(join(root, 'package.json')));
await writeFile(
  join(output, 'desktop-resource.json'),
  JSON.stringify({ identity: hash.digest('hex'), version: pkg.version, node: process.version }),
);
console.log(`Desktop resources prepared with Node ${process.version}.`);
