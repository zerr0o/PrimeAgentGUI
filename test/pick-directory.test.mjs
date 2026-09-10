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

test('an already cancelled request never starts a helper or prevents a later selection', async () => {
  let launches = 0;
  const picker = createDirectoryPicker({
    platform: 'win32',
    run: async () => {
      launches++;
      return { stdout: JSON.stringify({ cwd: tmpdir() }) };
    },
  });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await picker.pick({ signal: controller.signal }), { cwd: null });
  assert.equal(launches, 0);
  assert.deepEqual(await picker.pick(), { cwd: resolve(tmpdir()) });
  assert.equal(launches, 1);
});

test('client cancellation aborts the active helper and releases the guard for an immediate retry', async () => {
  let helperSignal;
  let started;
  const ready = new Promise((done) => {
    started = done;
  });
  let launches = 0;
  const picker = createDirectoryPicker({
    platform: 'win32',
    run: async (_cmd, _args, { signal }) => {
      launches++;
      if (launches > 1) return { stdout: JSON.stringify({ cwd: tmpdir() }) };
      helperSignal = signal;
      started();
      return new Promise((_done, reject) =>
        signal.addEventListener('abort', () => reject(new Error('helper aborted')), { once: true }),
      );
    },
  });
  const client = new AbortController();
  const first = picker.pick({ signal: client.signal });
  await ready;
  assert.equal(helperSignal.aborted, false);
  await assert.rejects(picker.pick(), { status: 409 });
  client.abort();
  assert.deepEqual(await first, { cwd: null });
  assert.equal(helperSignal.aborted, true);
  assert.deepEqual(await picker.pick(), { cwd: resolve(tmpdir()) });
  assert.equal(launches, 2);
});

test('cancelling an earlier completed request does not abort a later helper', async () => {
  const calls = [];
  const picker = createDirectoryPicker({
    platform: 'win32',
    run: async (_cmd, _args, { signal }) => {
      let complete;
      const result = new Promise((done, reject) => {
        complete = done;
        signal.addEventListener('abort', () => reject(new Error('helper aborted')), { once: true });
      });
      calls.push({ signal, complete });
      return result;
    },
  });
  const client = new AbortController();
  const first = picker.pick({ signal: client.signal });
  assert.equal(calls.length, 1);
  calls[0].complete({ stdout: '{"cwd":null}' });
  assert.deepEqual(await first, { cwd: null });
  const next = picker.pick();
  assert.equal(calls.length, 2);
  client.abort();
  assert.equal(calls[0].signal.aborted, false, 'Completed requests must detach the client abort listener');
  assert.equal(calls[1].signal.aborted, false);
  calls[1].complete({ stdout: JSON.stringify({ cwd: tmpdir() }) });
  assert.deepEqual(await next, { cwd: resolve(tmpdir()) });
});
