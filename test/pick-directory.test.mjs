import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createDirectoryPicker } from '../lib/pick-directory.mjs';

test('picker keeps paths out of commands, validates the result, and treats cancellation separately from failure', async () => {
  let output = JSON.stringify({ cwd: tmpdir() }),
    launch;
  const picker = createDirectoryPicker({
    platform: 'win32',
    run: async (...args) => {
      launch = args;
      return { stdout: output };
    },
  });
  assert.deepEqual(await picker.pick({ cwd: tmpdir(), title: 'Choisir é & $dossier' }), {
    cwd: resolve(tmpdir()),
  });
  assert.equal(launch[2].env.PRIME_STUDIO_PICK_DIRECTORY, resolve(tmpdir()));
  assert.equal(launch[2].env.PRIME_STUDIO_PICK_TITLE, 'Choisir é & $dossier');
  assert.equal(launch[1].includes(tmpdir()), false);
  assert.equal(launch[2].windowsHide, true);
  assert.equal(launch[2].shell, false);
  output = '{"cwd":null}';
  assert.deepEqual(await picker.pick({ cwd: 'not-a-directory' }), { cwd: null });
  assert.equal(launch[2].env.PRIME_STUDIO_PICK_DIRECTORY, '');
  for (output of ['{}', 'not json', '{"cwd":"relative/path"}'])
    await assert.rejects(picker.pick(), { status: 502 });
});

test('only one native picker opens at a time and shutdown aborts its helper', async () => {
  let started;
  const ready = new Promise((done) => {
    started = done;
  });
  const picker = createDirectoryPicker({
    platform: 'win32',
    run: async (_cmd, _args, { signal }) => {
      started();
      return new Promise((_done, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    },
  });
  const result = picker.pick();
  const failed = assert.rejects(result, { status: 502 });
  await ready;
  await assert.rejects(picker.pick(), { status: 409 });
  picker.close();
  await failed;
  await assert.rejects(createDirectoryPicker({ platform: 'linux' }).pick(), { status: 501 });
});
