// Isolated HTTP + browser attachment workflow. No user sessions or provider calls.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server.mjs';
import { createLanGateway, hashAccessCode } from '../lib/lan.mjs';
import { splitFileMessage } from '../lib/files.mjs';

const dir = await mkdtemp(join(tmpdir(), 'prime-attachments-ui-'));
const cwd = join(dir, 'Projet é'),
  sessionDir = join(dir, 'sessions'),
  agentHome = join(dir, 'agent');
await Promise.all([mkdir(cwd), mkdir(sessionDir), mkdir(agentHome)]);
const png = await readFile(new URL('../assets/prime-agent.png', import.meta.url));
const photo = { name: 'photo.png', mimeType: 'image/png', buffer: png };
const doc = { name: 'document é.json', mimeType: 'application/json', buffer: Buffer.from('{"test":true}') };
const images = [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }];
const starts = [],
  sends = [];
let current,
  failNext = false,
  sequence = 0;
const pending = { steering: [], followUp: [] };
async function persist(text, pictures = []) {
  const id = `message-${++sequence}`;
  await appendFile(
    current.file,
    JSON.stringify({
      type: 'message',
      id,
      parentId: current.lastId || null,
      message: { role: 'user', content: [{ type: 'text', text }, ...pictures], timestamp: Date.now() },
    }) + '\n',
  );
  current.lastId = id;
  const display = splitFileMessage(text);
  current.input.onEvent({ kind: 'message_start', role: 'user' });
  current.input.onEvent({
    kind: 'message',
    message: {
      id,
      role: 'user',
      text: display.text,
      attachments: [...pictures, ...display.attachments],
      tools: [],
      timestamp: Date.now(),
    },
  });
}
const runtime = {
  async getStatus() {
    return { available: true, version: 'fixture' };
  },
  async getModels() {
    return {
      models: [
        { id: 'fixture/vision', name: 'Modèle avec images', provider: 'fixture', input: ['text', 'image'] },
        { id: 'fixture/text', name: 'Texte uniquement', provider: 'fixture', input: ['text'] },
      ],
      default: { model: 'fixture/vision', thinking: 'low' },
    };
  },
  async start(input) {
    if (failNext) {
      failNext = false;
      throw new Error('Échec simulé ; brouillon conservé');
    }
    starts.push(input);
    let finish;
    current = {
      id: input.sessionId || 'attachments-session',
      input,
      file: join(sessionDir, 'native.jsonl'),
      done: new Promise((done) => {
        finish = done;
      }),
    };
    current.cancel = async () => {
      finish({ status: 'completed', code: 0 });
    };
    if (!input.sessionId)
      await writeFile(
        current.file,
        JSON.stringify({
          type: 'session',
          id: current.id,
          cwd,
          version: 3,
          timestamp: new Date().toISOString(),
        }) + '\n',
      );
    input.onEvent({ kind: 'session', sessionId: current.id, cwd });
    await persist(input.message, input.images);
    return { sessionId: current.id, done: current.done, cancel: current.cancel };
  },
  async close() {
    await current?.cancel();
  },
};
const snapshot = () => ({
  available: true,
  steering: pending.steering.map((m) => m.message),
  followUps: pending.followUp.map((m) => m.message),
});
const liveClient = {
  async getSnapshot() {
    return snapshot();
  },
  async send(id, cwd, input) {
    sends.push(input);
    pending[input.mode === 'steer' ? 'steering' : 'followUp'].push(input);
    return { accepted: true, snapshot: snapshot() };
  },
  async mutate(id, cwd, input) {
    const item = pending[input.lane][input.index];
    assert.equal(item.message, input.expectedText);
    if (input.mutation.type === 'replace') {
      pending[input.lane].splice(input.index, 1);
      item.message = input.mutation.text;
      pending[input.mutation.lane].push(item);
    }
    return { status: 'applied', snapshot: snapshot() };
  },
};
const app = createApp({
  runtime,
  liveClient,
  sessionDir,
  agentHome,
  dataDir: join(dir, 'data'),
  initialCwd: cwd,
});
await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
const local = `http://127.0.0.1:${app.server.address().port}`;
const salt = 'f'.repeat(32),
  code = '12345678';
const gateway = createLanGateway({
  host: '127.0.0.1',
  upstreamPort: app.server.address().port,
  config: { salt, codeHash: hashAccessCode(code, salt), readOnly: false },
});
await new Promise((done) => gateway.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${gateway.address().port}`;
let browser;
const checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('#code').fill(code);
  await page.getByRole('button', { name: 'Ouvrir le studio' }).click();
  await page.locator('#toggle-sidebar').click();
  await page.locator('#new-session').click();
  await expect(page.locator('#attach-images')).toBeEnabled();
  const select = async (button, files) => {
    try {
      await expect(page.locator(button)).toBeVisible();
      await expect(page.locator(button)).toBeEnabled();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(button).click()]);
      await chooser.setFiles(files);
    } catch (error) {
      await page.screenshot({ path: resolve('.local', 'attachment-failure.png') });
      console.error(await page.locator('#composer-form').evaluate((el) => el.outerHTML.slice(0, 6000)));
      throw error;
    }
  };
  await select('#attach-images', photo);
  await expect(page.locator('#image-files')).toHaveAttribute('accept', 'image/*');
  await expect(page.locator('#image-files')).not.toHaveAttribute('capture');
  await select('#attach-files', doc);
  await expect(page.locator('#attachment-files')).not.toHaveAttribute('accept');
  await expect(page.locator('.image-draft')).toHaveCount(2);
  await expect(page.locator('#send-button')).toBeEnabled();
  await page.reload();
  await expect(page.locator('.image-draft')).toHaveCount(2);
  checks.push(
    'Separate photo gallery and unrestricted file pickers; attachment-only drafts survive reload over authenticated remote access.',
  );

  await page.getByRole('button', { name: 'Retirer photo.png' }).click();
  await page.getByRole('button', { name: 'Retirer document é.json' }).click();
  async function transfer(eventName) {
    await page.evaluate(
      ({ eventName, data }) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'image-transférée.png', {
            type: 'image/png',
          }),
        );
        transfer.items.add(
          new File(['document collé ou déposé'], 'texte-transféré.txt', { type: 'text/plain' }),
        );
        if (eventName === 'paste')
          document
            .getElementById('composer')
            .dispatchEvent(
              new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
            );
        else
          document
            .getElementById('composer-form')
            .dispatchEvent(
              new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
            );
      },
      { eventName, data: images[0].data },
    );
  }
  await transfer('drop');
  await expect(page.locator('.image-draft')).toHaveCount(2);
  await transfer('paste');
  await expect(page.locator('.image-draft')).toHaveCount(4);
  checks.push('Drag-and-drop and clipboard file items both accept images and documents.');

  failNext = true;
  await page.locator('#send-button').click();
  await expect(page.locator('.toast').filter({ hasText: 'Échec simulé' })).toBeVisible();
  await expect(page.locator('.image-draft')).toHaveCount(4);
  await expect(page.locator('#send-button')).toBeEnabled();
  await page.locator('#send-button').click();
  await expect(page.locator('.image-draft')).toHaveCount(0);
  await expect(page.locator('.message.user .message-image')).toHaveCount(2);
  await expect(page.locator('.message.user .message-file')).toHaveCount(2);
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].images, [images[0], images[0]]);
  const saved = splitFileMessage(starts[0].message).attachments;
  const download = await context.request.get(`${url}/api/files/${saved[0].id}`);
  assert.equal(download.status(), 200);
  assert.equal((await download.body()).toString(), 'document collé ou déposé');
  const unauthenticated = await fetch(`${url}/api/files/${saved[0].id}`);
  assert.equal(unauthenticated.status, 401);
  await page.reload();
  await expect(page.locator('.message.user .message-image')).toHaveCount(2);
  await expect(page.locator('.message.user .message-file')).toHaveCount(2);
  await page.locator('.message-image').first().click();
  await expect(page.locator('.image-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.image-viewer')).toHaveCount(0);
  checks.push(
    'Failed upload keeps its draft; accepted images and downloadable file bytes round-trip through HTTP, streaming and native history.',
  );

  for (const mode of ['steer', 'follow_up']) {
    await select('#attach-images', photo);
    await select('#attach-files', doc);
    await page.locator('#composer').fill(`Consigne ${mode}`);
    await page.locator(`[data-mode="${mode}"]`).click();
    await expect(page.locator('#send-button')).toBeEnabled();
    await page.locator('#send-button').click();
    await expect(page.locator('.image-draft')).toHaveCount(0);
  }
  assert.equal(starts.length, 1);
  assert.equal(sends.length, 2);
  for (const sent of sends) {
    assert.deepEqual(sent.images, images);
    assert.equal(splitFileMessage(sent.message).attachments[0].name, doc.name);
  }
  checks.push(
    'Both live delivery modes send image blocks and durable file references without starting or stopping a session.',
  );

  await select('#attach-images', photo);
  await select('#attach-files', doc);
  await page.locator('#composer').fill('Examine cette photo et le document joint.');
  await mkdir(resolve('.local', 'attachment-checks'), { recursive: true });
  for (const width of [320, 390, 1365]) {
    await page.setViewportSize({ width, height: width > 760 ? 950 : 844 });
    await page.screenshot({ path: resolve('.local', 'attachment-checks', `composer-${width}.png`) });
    const layout = await page.evaluate(() => {
      const bounds = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        form: bounds('composer-form'),
        controls: [
          'attach-images',
          'attach-files',
          'composer',
          'model-picker-button',
          'thinking-select',
          'stop-button',
          'send-button',
        ].map(bounds),
      };
    });
    assert.ok(layout.scroll <= width, `No page overflow at ${width}`);
    for (const b of layout.controls)
      assert.ok(
        b.x >= layout.form.x && b.right <= layout.form.right + 1 && b.width >= 20,
        `Controls fit composer at ${width}: ${JSON.stringify(b)}`,
      );
    for (let i = 0; i < layout.controls.length; i++)
      for (let j = i + 1; j < layout.controls.length; j++) {
        const a = layout.controls[i],
          b = layout.controls[j];
        assert.ok(
          Math.min(a.right, b.right) - Math.max(a.x, b.x) < 1 ||
            Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) < 1,
          `No overlapping controls at ${width}`,
        );
      }
  }
  checks.push(
    'Mobile 320/390 and desktop 1365: photo, file, model, effort, stop and send remain distinct without overflow.',
  );

  await page.locator('#new-session').click();
  await expect(page.locator('.image-draft')).toHaveCount(0);
  await select('#attach-files', { ...doc, name: 'autre-brouillon.json' });
  await page.locator('.session-select').first().click();
  await expect(page.locator('.image-draft')).toHaveCount(2);
  await expect(page.locator('.file-draft-name')).toHaveText(doc.name);
  await page.reload();
  await expect(page.locator('.image-draft')).toHaveCount(2);
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    delete body.preferences.attachments;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(page.locator('#attach-images')).toBeDisabled();
  await expect(page.locator('#send-button')).toBeDisabled();
  await expect(page.locator('.image-draft')).toHaveCount(2);
  await page.unroute('**/api/bootstrap');
  await page.reload();
  await expect(page.locator('#attach-images')).toBeEnabled();
  await expect(page.locator('#send-button')).toBeEnabled();
  checks.push('Per-session drafts remain distinct; an old server cannot silently discard attachments.');

  // Payload beyond the old 512 KB limit must pass the authenticated proxy intact.
  const response = await context.request.post(`${url}/api/live/sessions/${current.id}/messages`, {
    data: {
      cwd,
      message: 'Gros fichier',
      mode: 'follow_up',
      requestId: 'large-file-request-123',
      files: [{ name: 'large.bin', data: Buffer.alloc(600 * 1024, 179).toString('base64') }],
    },
  });
  assert.equal(response.status(), 200);
  const large = splitFileMessage(sends.at(-1).message).attachments[0];
  const bytes = await context.request.get(`${url}/api/files/${large.id}`);
  assert.equal((await bytes.body()).length, 600 * 1024);
  const textOnly = await fetch(`${local}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, message: '', images, model: 'fixture/text' }),
  });
  assert.equal(textOnly.status, 400);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser?.close();
  await new Promise((done) => gateway.close(done));
  await app.close();
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  await rm(dir, { recursive: true, force: true });
}
