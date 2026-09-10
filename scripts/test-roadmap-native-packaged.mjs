// Build a disposable desktop resource tree, then run the real native fixture
// with its copied Node from outside the checkout. Never touches an installation.
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { desktopRuntimeScripts, verifyDesktopRuntimeResources } from './desktop-runtime-resources.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(join(tmpdir(), 'prime-roadmap-packaged-'));
const studio = join(root, 'studio'),
  outside = join(root, 'outside');
await Promise.all([mkdir(studio), mkdir(outside)]);
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
  await cp(join(source, name), join(studio, name), {
    recursive: true,
    filter: (path) => !path.includes('__pycache__') && !path.endsWith('.pyc'),
  });
await mkdir(join(studio, 'scripts'));
for (const name of [...desktopRuntimeScripts, 'test-roadmap-native.mjs'])
  await cp(join(source, 'scripts', name), join(studio, 'scripts', name));
await verifyDesktopRuntimeResources(studio);
const node = join(root, process.platform === 'win32' ? 'node.exe' : 'node');
await cp(process.execPath, node);
const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
execFileSync(node, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: studio,
  windowsHide: true,
  timeout: 120000,
  stdio: 'pipe',
});
const output = execFileSync(node, [join(studio, 'scripts/test-roadmap-native.mjs')], {
  cwd: outside,
  windowsHide: true,
  timeout: 180000,
  stdio: 'pipe',
  encoding: 'utf8',
});
const proof = JSON.parse(output);
assert.equal(proof.passed, true);
assert.equal(
  await readFile(join(studio, 'runtime/studio-roadmap-extension.mjs'), 'utf8'),
  await readFile(join(source, 'runtime/studio-roadmap-extension.mjs'), 'utf8'),
);
console.log(
  JSON.stringify(
    {
      passed: true,
      root,
      nativeProof: join(proof.root, 'proof.json'),
      checks: [
        'Desktop resource dependency closure',
        'Copied Node launched from unrelated directory',
        ...proof.checks,
      ],
    },
    null,
    2,
  ),
);
