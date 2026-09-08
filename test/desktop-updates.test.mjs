import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { updateManifest } from '../scripts/desktop-update-manifest.mjs';
test('release catalog uses the real signature and a stable GitHub installer name', async () => {
  const signature = await readFile(new URL('./fixtures/updater/payload.txt.sig', import.meta.url), 'utf8');
  const manifest = updateManifest({ version: '2.8.0', signature, notes: 'Release notes' });
  assert.equal(manifest.platforms['windows-x86_64'].signature, signature.trim());
  assert.equal(
    manifest.platforms['windows-x86_64'].url,
    'https://github.com/zerr0o/prime-agent-studio/releases/download/v2.8.0/Prime-Agent-Studio_2.8.0_x64-setup.exe',
  );
  assert.equal(manifest.notes, 'Release notes');
  for (const version of ['../x', '2.8.0-beta.1', 'latest'])
    assert.throws(() => updateManifest({ version, signature }));
  for (const signature of ['', 'not-a-signature'])
    assert.throws(() => updateManifest({ version: '2.8.0', signature }));
});
