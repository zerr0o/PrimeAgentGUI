import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { validateImages, persistImages, imageMessageText, imageBodyLimit } from '../lib/images.mjs';
import { validateFiles, createFileStore, appendFileMessage, splitFileMessage } from '../lib/files.mjs';
import { createLiveMessages } from '../lib/live-messages.mjs';

const image = {
  type: 'image',
  mimeType: 'image/png',
  data: (await readFile(new URL('../assets/prime-agent.png', import.meta.url))).toString('base64'),
};
const file = { name: 'données é.json', data: Buffer.from('{"été":true}').toString('base64') };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'prime-files-'));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('attachments validate formats, actual image signature, encoding, names and byte limits', () => {
  assert.deepEqual(validateImages([image]), [image]);
  assert.deepEqual(validateFiles([file, { name: 'vide.txt', data: '' }]), [
    file,
    { name: 'vide.txt', data: '' },
  ]);
  for (const bad of [
    { ...image, mimeType: 'image/svg+xml' },
    { ...image, data: 'YWJj' },
    { ...image, data: image.data + '\n' },
  ])
    assert.throws(() => validateImages([bad]), { status: 400 });
  assert.throws(() => validateImages(Array(5).fill(image)), { status: 400 });
  assert.throws(() => validateImages([{ ...image, data: 'A'.repeat(6 * 1024 * 1024) }]), { status: 413 });
  for (const name of ['../private.txt', 'C:\\secret', 'a/b', 'a\u0000b', ''])
    assert.throws(() => validateFiles([{ ...file, name }]), { status: 400 });
  assert.throws(() => validateFiles([{ ...file, data: 'YQ==' + 'AAAA' }]), { status: 400 });
  assert.throws(() => validateFiles([{ ...file, data: 'A'.repeat(15 * 1024 * 1024) }]), { status: 413 });
  assert.equal(imageBodyLimit('/api/live/sessions/session-1/messages'), 40 * 1024 * 1024);
  assert.equal(imageBodyLimit('/api/live/sessions/session-1/queue'), 512 * 1024);
});

test('JSON, binary and empty files retain exact bytes and names in a confined durable store', async (t) => {
  const dir = await fixture(t),
    store = createFileStore(dir);
  const files = [
    file,
    { name: 'archive.zip', data: Buffer.from([0, 255, 128, 7]).toString('base64') },
    { name: 'vide.txt', data: '' },
  ];
  const saved = await store.save(validateFiles(files));
  for (let i = 0; i < files.length; i++) {
    assert.ok(saved[i].path.startsWith(dir + sep));
    const restored = await createFileStore(dir).read(saved[i].id);
    assert.equal(restored.name, files[i].name);
    assert.equal(restored.data.toString('base64'), files[i].data);
  }
  await assert.rejects(store.read('../secret'), { status: 404 });
  const imagePaths = await persistImages([image, image], join(dir, '.studio-images'));
  assert.equal(imagePaths[0], imagePaths[1]);
  assert.equal((await readFile(imagePaths[0])).toString('base64'), image.data);
  const nativeText =
    appendFileMessage('Inspecte les pièces jointes.', saved) + `<file name="${imagePaths[0]}"></file>\n`;
  const display = splitFileMessage(imageMessageText(nativeText));
  assert.equal(display.text, 'Inspecte les pièces jointes.');
  assert.deepEqual(
    display.attachments.map((item) => item.name),
    files.map((item) => item.name),
  );
  assert.ok(!JSON.stringify(display).includes(dir));
  assert.equal(
    splitFileMessage('Texte <prime_studio_files> invalide').text,
    'Texte <prime_studio_files> invalide',
  );
});

test('live retries persist files once, fingerprint attachment bytes, and edits preserve file references', async (t) => {
  const dir = await fixture(t),
    calls = [],
    fileStore = createFileStore(dir);
  const run = { sessionId: 'session-test', cwd: dir, status: 'running' };
  const client = {
    async send(id, cwd, input) {
      calls.push(input);
      return { accepted: true };
    },
    async mutate(id, cwd, input) {
      calls.push(input);
      return { status: 'applied' };
    },
  };
  const live = createLiveMessages({ getRuns: () => [run], getClient: () => client, fileStore });
  const body = {
    cwd: dir,
    mode: 'steer',
    message: '',
    images: [image],
    files: [file],
    requestId: 'attachment-request-123',
  };
  await Promise.all([live.send(run.sessionId, body), live.send(run.sessionId, body)]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].images, [image]);
  assert.equal((await readdir(dir)).length, 2);
  assert.equal(splitFileMessage(calls[0].message).text, 'Analyse les pièces jointes.');
  await assert.rejects(live.send(run.sessionId, { ...body, files: [{ ...file, data: '' }] }), {
    status: 409,
  });
  await assert.rejects(live.send(run.sessionId, { ...body, images: [] }), { status: 409 });
  await live.mutate(run.sessionId, {
    cwd: dir,
    lane: 'steering',
    index: 0,
    expectedText: calls[0].message,
    mutation: { type: 'replace', lane: 'followUp', text: 'Nouvelle consigne' },
  });
  assert.equal(splitFileMessage(calls[1].mutation.text).text, 'Nouvelle consigne');
  assert.deepEqual(
    splitFileMessage(calls[1].mutation.text).attachments,
    splitFileMessage(calls[0].message).attachments,
  );
  assert.ok(
    !Object.hasOwn(calls[1].mutation, 'images'),
    'Native queue retains its image blocks when images are omitted',
  );
});
