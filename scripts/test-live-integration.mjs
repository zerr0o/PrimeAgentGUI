import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createApp } from '../server.mjs';

const temp = await mkdtemp(join(tmpdir(), 'prime-live-integration-'));
const cwd = join(temp, 'Projet de test');
const sessionDir = join(temp, 'sessions');
const agentHome = join(temp, 'agent');
await Promise.all([mkdir(cwd), mkdir(sessionDir), mkdir(agentHome)]);
const sessions = new Map();
const starts = [];
const liveSends = [];
let entryId = 0;

async function persist(conversation, role, text) {
  const id = `entry-${++entryId}`;
  const message = { role, content: [{ type: 'text', text }], timestamp: Date.now() };
  await appendFile(
    conversation.file,
    JSON.stringify({ type: 'message', id, parentId: conversation.lastEntryId || null, message }) + '\n',
  );
  conversation.lastEntryId = id;
  return { role, text, timestamp: message.timestamp, tools: [] };
}

const runtime = {
  async getStatus() {
    return { available: true, version: '0.9.1', cli: 'isolated-fixture' };
  },
  async getModels() {
    return {
      models: [
        { id: 'openai-codex/gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'openai-codex', reasoning: true },
      ],
      default: { model: 'openai-codex/gpt-5.6-luna', thinking: 'low' },
    };
  },
  async start(input) {
    const index = starts.length + 1;
    const id = input.sessionId || `live-session-${index}`;
    let conversation = sessions.get(id);
    if (!conversation) {
      conversation = { id, file: join(sessionDir, `native-filename-${index}.jsonl`), lastEntryId: null };
      await writeFile(
        conversation.file,
        JSON.stringify({ type: 'session', id, version: 3, cwd, timestamp: new Date().toISOString() }) + '\n',
      );
      sessions.set(id, conversation);
    }
    let complete;
    let finished = false;
    const pending = { steering: [], followUp: [] };
    const done = new Promise((resolveDone) => {
      complete = resolveDone;
    });
    const emit = (event) => input.onEvent(event);
    async function finish(status = 'completed') {
      if (finished) return;
      finished = true;
      if (status === 'completed') {
        const message = await persist(conversation, 'assistant', `Réponse finale ${index}`);
        emit({ kind: 'message_start', role: 'assistant' });
        emit({ kind: 'message', message });
      }
      const result = { kind: 'done', sessionId: id, status, code: 0 };
      emit(result);
      complete(result);
    }
    const handle = {
      sessionId: id,
      done,
      input,
      pending,
      finish,
      get finished() {
        return finished;
      },
      cancel: () => finish('stopped'),
      async deliver() {
        for (const lane of ['steering', 'followUp']) {
          while (pending[lane].length) {
            const message = await persist(conversation, 'user', pending[lane].shift());
            emit({ kind: 'message_start', role: 'user' });
            emit({ kind: 'message', message });
          }
        }
      },
    };
    conversation.handle = handle;
    starts.push(handle);
    emit({ kind: 'session', sessionId: id, cwd });
    const initialMessage = await persist(conversation, 'user', input.message);
    emit({ kind: 'message_start', role: 'user' });
    emit({ kind: 'message', message: initialMessage });
    return handle;
  },
  async close() {
    await Promise.all(starts.map((handle) => handle.cancel()));
  },
};

function active(sessionId, requestedCwd) {
  assert.equal(requestedCwd, cwd);
  const handle = sessions.get(sessionId)?.handle;
  if (!handle || handle.finished) throw Object.assign(new Error('Session terminée'), { status: 409 });
  return handle;
}
function snapshot(handle) {
  return { available: true, steering: [...handle.pending.steering], followUps: [...handle.pending.followUp] };
}
const liveClient = {
  async getSnapshot(sessionId, requestedCwd) {
    return snapshot(active(sessionId, requestedCwd));
  },
  async send(sessionId, requestedCwd, input) {
    const handle = active(sessionId, requestedCwd);
    liveSends.push({ sessionId, ...input });
    handle.pending[input.mode === 'steer' ? 'steering' : 'followUp'].push(input.message);
    return { accepted: true, snapshot: snapshot(handle) };
  },
  async mutate() {
    throw new Error('Queue editing belongs to the separate live UI test');
  },
};
const app = createApp({
  runtime,
  liveClient,
  sessionDir,
  agentHome,
  dataDir: join(temp, 'data'),
  initialCwd: cwd,
});
await new Promise((resolveListen) => app.server.listen(0, '127.0.0.1', resolveListen));
const url = `http://127.0.0.1:${app.server.address().port}`;
let browser;
const checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1365, height: 950 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(`Browser error: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await expect(page.locator('#connection-label')).not.toHaveText('Connexion…');
  await page.locator('#new-session').click();
  const prompt = 'Demande initiale : améliorer le projet';
  const steering = 'Instruction en direct : garde le premier message';
  const followUp = 'Message suivant : ajoute la documentation';
  const users = () => page.locator('#messages .message.user .message-body');
  await page.locator('#composer').fill(prompt);
  await expect(page.locator('#send-button')).toBeEnabled();
  await page.locator('#send-button').click();
  await expect(page.locator('#stop-button')).toBeVisible();
  await expect(users()).toHaveText([prompt]);
  checks.push('Initial optimistic prompt and native echo appear exactly once.');

  await page.locator('#composer').fill(steering);
  await page.locator('[data-mode="steer"]').click();
  await expect(page.locator('#send-button')).toBeEnabled();
  await page.locator('#send-button').click();
  await expect(page.locator('#composer')).toHaveValue('');
  await expect(page.locator('.live-queue-count')).toHaveText('1');
  await expect(users()).toHaveText([prompt]);
  await page.locator('#composer').fill(followUp);
  await page.locator('[data-mode="follow_up"]').click();
  await page.locator('#send-button').click();
  await expect(page.locator('#composer')).toHaveValue('');
  await expect(page.locator('.live-queue-count')).toHaveText('2');
  assert.equal(starts.length, 1, 'Live submission must not create another run');
  assert.deepEqual(
    liveSends.map((input) => input.mode),
    ['steer', 'follow_up'],
  );
  checks.push(
    'Both live modes reach the real HTTP service; accepted queues do not create transcript bubbles.',
  );

  await starts[0].deliver();
  await expect(users()).toHaveText([prompt, steering, followUp]);
  await page.reload();
  await expect(page.locator('#stop-button')).toBeVisible();
  await expect(users()).toHaveText([prompt, steering, followUp]);
  assert.equal(starts.length, 1, 'Reload must attach to the existing run');
  checks.push(
    'Two native live user messages append distinctly through SSE and survive history plus replay without duplicates.',
  );

  await starts[0].finish();
  await expect(page.locator('#stop-button')).toBeHidden();
  await expect(users()).toHaveText([prompt, steering, followUp]);
  await expect(page.locator('#messages .message.assistant .message-body')).toContainText('Réponse finale 1');
  const next = 'Nouvelle demande normale après la fin';
  await page.locator('#composer').fill(next);
  await expect(page.locator('#send-button')).toBeEnabled();
  await page.locator('#send-button').click();
  await expect(page.locator('#stop-button')).toBeVisible();
  await expect(users()).toHaveText([prompt, steering, followUp, next]);
  assert.equal(starts.length, 2);
  assert.equal(starts[1].input.sessionId, starts[0].sessionId);
  assert.equal(liveSends.length, 2, 'A completed run must use normal message submission');
  const resumedSteering = 'Consigne en direct pendant la reprise de cette même session';
  await page.locator('#composer').fill(resumedSteering);
  await page.locator('[data-mode="steer"]').click();
  await expect(page.locator('#send-button')).toBeEnabled();
  await page.locator('#send-button').click();
  await expect(page.locator('#composer')).toHaveValue('');
  await expect(page.locator('.live-queue-count')).toHaveText('1');
  assert.equal(starts.length, 2, 'Live input after resume must use the running execution');
  assert.equal(liveSends.length, 3);
  await starts[1].deliver();
  await expect(users()).toHaveText([prompt, steering, followUp, next, resumedSteering]);
  checks.push('Live input stays enabled after resuming a session with a retained completed run.');
  await starts[1].finish();
  await expect(page.locator('#stop-button')).toBeHidden();
  await page.reload();
  await expect(users()).toHaveText([prompt, steering, followUp, next, resumedSteering]);
  await expect(page.locator('#messages .message.assistant .message-body')).toHaveCount(2);
  checks.push(
    'Final completion restores normal same-session sending; both finished turns survive another reload.',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/live-integration-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    checks,
    starts: starts.length,
    liveSends: liveSends.length,
    browserErrors: errors,
  };
  await writeFile('test-results/live-integration-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await app.close();
  const absolute = resolve(temp);
  if (
    !absolute.startsWith(resolve(tmpdir()) + sep) ||
    !basename(absolute).startsWith('prime-live-integration-')
  )
    throw new Error('Unexpected fixture cleanup path');
  await rm(absolute, { recursive: true, force: true });
}
