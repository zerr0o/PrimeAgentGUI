import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createFileOpener, fileLaunchMode } from '../lib/open-file.mjs';

test('native open passes a literal filename to a hidden helper and requires Shell acceptance', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prime-native-file-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const path = join(root, 'rapport é & [1]; $test.md');
  await writeFile(path, '# Fixture');
  let call,
    response = '{"opened":true}';
  const opener = createFileOpener({
    platform: 'win32',
    run: async (...args) => {
      call = args;
      return { stdout: response };
    },
  });
  assert.deepEqual(await opener(path), { opened: true });
  assert.equal(call[2].windowsHide, true);
  assert.equal(call[2].shell, false);
  assert.equal(call[2].env.PRIME_STUDIO_OPEN_FILE, path);
  assert.equal(call[2].env.PRIME_STUDIO_FILE_MODE, 'associated');
  assert.equal(call[1].includes(path), false);
  assert.equal(call[1].includes('-Command'), false);
  response = '{"opened":false}';
  await assert.rejects(opener(path), { status: 502 });
  await assert.rejects(opener(join(root, 'missing.md')), { status: 404 });
});

test('source scripts go to an editor and executables or shortcuts cannot be launched as documents', () => {
  for (const path of ['notes.md', 'report.pdf', 'table.xlsx'])
    assert.equal(fileLaunchMode(path), 'associated');
  for (const path of ['script.ps1', 'script.js', 'script.bat', 'script.py', 'README'])
    assert.equal(fileLaunchMode(path), 'editor');
  for (const path of ['app.exe', 'shortcut.lnk', 'page.url', 'installer.msi', 'run.hta'])
    assert.throws(() => fileLaunchMode(path), { status: 400 });
});
