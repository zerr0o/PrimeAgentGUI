// Isolated browser regression: this never starts a real Prime Agent or model.
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createApp } from '../server.mjs';

const temp = await mkdtemp(join(tmpdir(), 'prime-studio-conversation-'));
const cwd = join(temp, 'Conversation');
const sessionDir = join(temp, 'sessions');
const sessionId = 'conversation-grouping-fixture';
const sessionFile = join(sessionDir, 'native-conversation.jsonl');
await Promise.all([mkdir(cwd), mkdir(sessionDir)]);
const entry = (id, parentId, role, content, extra = {}) => ({
  type: 'message',
  id,
  parentId,
  message: { role, content, timestamp: Date.now(), ...extra },
});
const tool = (id, code) => ({ type: 'toolCall', id, name: 'ipython', arguments: { code } });
const text = (value) => ({ type: 'text', text: value });
const thinking = (value) => ({ type: 'thinking', thinking: value });
const fixture = [
  { type: 'session', id: sessionId, cwd, version: 3, timestamp: new Date().toISOString() },
  entry('u1', null, 'user', 'Analyse les deux étapes de vérification.'),
  entry('a1', 'u1', 'assistant', [thinking('REASONING_ONE_8123'), tool('t1', 'print("first")')]),
  entry('r1', 'a1', 'toolResult', [text('TOOL_ONE_RESULT_8123')], {
    toolCallId: 't1',
    toolName: 'ipython',
    isError: false,
  }),
  entry('a2', 'r1', 'assistant', [
    thinking('REASONING_TWO_8123'),
    tool('t2', 'raise RuntimeError("expected")'),
  ]),
  entry('r2', 'a2', 'toolResult', [text('TOOL_TWO_EXPECTED_FAILURE_8123')], {
    toolCallId: 't2',
    toolName: 'ipython',
    isError: true,
  }),
  entry('a3', 'r2', 'assistant', [text('Les deux étapes sont terminées.')]),
  entry('u2', 'a3', 'user', 'Et le résultat final ?'),
  entry('a4', 'u2', 'assistant', [text('Le résultat demandé est disponible.')]),
  {
    type: 'custom_message',
    id: 'context1',
    parentId: 'a4',
    display: true,
    content: 'Contexte actualisé pour la suite.',
  },
  entry('a5', 'context1', 'assistant', [text('Message après le contexte actualisé.')]),
];
await writeFile(sessionFile, fixture.map(JSON.stringify).join('\n') + '\n');

const controls = [];
const runtime = {
  getStatus: async () => ({ available: true, version: 'fixture' }),
  getModels: async () => ({
    models: [
      {
        id: 'fixture/a-very-long-model-identifier-for-mobile-layout',
        name: 'Modèle de vérification au nom volontairement très long',
        provider: 'fixture',
        reasoning: true,
      },
    ],
    default: { model: 'fixture/a-very-long-model-identifier-for-mobile-layout', thinking: 'xhigh' },
  }),
  async start(input) {
    const serial = controls.length + 1;
    const file = input.sessionFile;
    if (file !== sessionFile) throw new Error('Only the isolated fixture session may be resumed.');
    let parentId = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse)
      .findLast((record) => record.type === 'message').id;
    async function persist(id, role, content, extra) {
      await appendFile(file, JSON.stringify(entry(id, parentId, role, content, extra)) + '\n');
      parentId = id;
    }
    await persist(`live-user-${serial}`, 'user', input.message);
    let resolveDone,
      finished = false;
    const done = new Promise((resolveCompletion) => {
      resolveDone = resolveCompletion;
    });
    const control = {
      sessionId,
      done,
      async step(number, isError = false) {
        const id = `live-tool-${serial}-${number}`;
        const reasoning = `LIVE_REASONING_${number}`;
        const result = `LIVE_TOOL_${number}_${isError ? 'ERROR' : 'RESULT'}`;
        await persist(`live-call-${serial}-${number}`, 'assistant', [
          thinking(reasoning),
          tool(id, `print(${number})`),
        ]);
        input.onEvent({
          kind: 'message',
          message: {
            role: 'assistant',
            text: '',
            thinking: reasoning,
            tools: [{ id, name: 'ipython', args: { code: `print(${number})` }, status: 'pending' }],
          },
        });
        input.onEvent({ kind: 'tool_start', id, name: 'ipython', args: { code: `print(${number})` } });
        await persist(`live-result-${serial}-${number}`, 'toolResult', [text(result)], {
          toolCallId: id,
          toolName: 'ipython',
          isError,
        });
        input.onEvent({
          kind: 'tool_end',
          id,
          name: 'ipython',
          result: { content: [text(result)] },
          isError,
        });
      },
      emit(event) {
        if (!finished) input.onEvent(event);
      },
      async finish(status = 'completed') {
        if (finished) return done;
        finished = true;
        if (status === 'completed') {
          await persist(`live-final-${serial}`, 'assistant', [text('La réponse en direct est terminée.')]);
          input.onEvent({
            kind: 'message',
            message: { role: 'assistant', text: 'La réponse en direct est terminée.', tools: [] },
          });
        }
        const result = { kind: 'done', sessionId, status, code: status === 'completed' ? 0 : 130 };
        input.onEvent(result);
        resolveDone(result);
        return result;
      },
      cancel() {
        return control.finish('stopped');
      },
    };
    controls.push(control);
    setTimeout(() => control.emit({ kind: 'session', sessionId, cwd: input.cwd }), 20);
    return control;
  },
  async close() {
    await Promise.all(controls.map((control) => control.finish('stopped')));
  },
};

const app = createApp({ runtime, sessionDir, dataDir: join(temp, 'data'), initialCwd: cwd });
await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${app.server.address().port}`;
const checks = [];
let browser, page;
async function visibleAgentHeadings() {
  return page
    .locator('#messages .message-author')
    .filter({ hasText: /^Prime Agent$/ })
    .evaluateAll(
      (nodes) =>
        nodes.filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
        }).length,
    );
}
const composerMeasurements = [];
const composerWidths = [320, 390, 480, 760, 1280];
async function assertToolbarFits(width, active) {
  await page.setViewportSize({ width, height: 844 });
  const actionSelector = active ? '#stop-button' : '#send-button';
  const hiddenSelector = active ? '#send-button' : '#stop-button';
  await expect(page.locator(hiddenSelector)).toBeHidden();
  await expect(page.locator(actionSelector)).toBeVisible();
  await expect(page.locator(actionSelector)).toHaveAccessibleName(active ? /arrêter/i : /envoyer/i);
  await expect(page.locator('#composer')).toHaveValue('');
  await expect(page.locator('#model-picker-button')).toBeVisible();
  await expect(page.locator('#thinking-select')).toBeVisible();
  const rects = await page.evaluate((selector) => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    return {
      action: rect(selector),
      model: rect('#model-picker-button'),
      thinking: rect('#thinking-select'),
      form: rect('#composer-form'),
      textarea: rect('#composer'),
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, actionSelector);
  const overlaps = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  expect(overlaps(rects.action, rects.model), `Model picker overlaps action at ${width}px`).toBe(false);
  expect(overlaps(rects.action, rects.thinking), `Thinking select overlaps action at ${width}px`).toBe(false);
  expect(overlaps(rects.model, rects.thinking), `Model and thinking controls overlap at ${width}px`).toBe(
    false,
  );
  const centerY = (box) => (box.top + box.bottom) / 2;
  for (const name of ['action', 'model', 'thinking']) {
    expect(rects[name].left, `${name} exceeds left viewport at ${width}px`).toBeGreaterThanOrEqual(-0.5);
    expect(rects[name].right, `${name} exceeds right viewport at ${width}px`).toBeLessThanOrEqual(
      rects.viewport + 0.5,
    );
    expect(
      Math.abs(centerY(rects[name]) - centerY(rects.action)),
      `${name} is not on the action row at ${width}px (${active ? 'running' : 'idle'})`,
    ).toBeLessThanOrEqual(2);
  }
  for (const dimension of ['width', 'height']) {
    expect(rects.action[dimension], `Action target ${dimension} at ${width}px`).toBeGreaterThanOrEqual(43.5);
    expect(rects.action[dimension], `Action target ${dimension} at ${width}px`).toBeLessThanOrEqual(44.5);
  }
  if (width <= 760)
    expect(rects.form.height, `Empty mobile composer is too tall at ${width}px`).toBeLessThanOrEqual(145);
  expect(rects.scrollWidth).toBeLessThanOrEqual(rects.viewport + 1);
  composerMeasurements.push({
    width,
    active,
    formHeight: rects.form.height,
    textareaHeight: rects.textarea.height,
    action: rects.action,
    model: rects.model,
    thinking: rects.thinking,
  });
  await page.screenshot({
    path: resolve('test-results', `conversation-${active ? 'active' : 'idle'}-${width}.png`),
    animations: 'disabled',
  });
}

try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator('#connection-label')).toContainText('connecté');
  await page
    .locator('#session-list')
    .getByText('Analyse les deux étapes de vérification.', { exact: true })
    .click();
  await expect(page.locator('#messages')).toContainText('Le résultat demandé est disponible.');
  await expect.poll(visibleAgentHeadings).toBe(3);
  await expect(page.locator('#messages .assistant-turn')).toHaveCount(3);
  await expect(page.locator('#messages .message.user')).toHaveCount(2);
  const activities = page.locator('#messages .activity-stack');
  await expect(activities).toHaveCount(1);
  const firstActivity = activities.first();
  await expect(firstActivity).not.toHaveAttribute('open', '');
  await expect(firstActivity.locator(':scope > summary')).toContainText(/erreur/i);
  await expect(page.getByText('TOOL_ONE_RESULT_8123', { exact: true })).toBeHidden();
  await expect(page.getByText('TOOL_TWO_EXPECTED_FAILURE_8123', { exact: true })).toBeHidden();
  await expect(page.getByText('Les deux étapes sont terminées.', { exact: true })).toBeVisible();
  await firstActivity.locator(':scope > summary').click();
  await expect(firstActivity).toHaveAttribute('open', '');
  await expect(firstActivity.locator('.tool-block')).toHaveCount(2);
  await expect(firstActivity.locator('.thinking-block')).toHaveCount(2);
  for (const details of await firstActivity.locator('.tool-block, .thinking-block').all()) {
    if (!(await details.evaluate((node) => node.open))) await details.locator(':scope > summary').click();
  }
  for (const marker of [
    'TOOL_ONE_RESULT_8123',
    'TOOL_TWO_EXPECTED_FAILURE_8123',
    'REASONING_ONE_8123',
    'REASONING_TWO_8123',
  ])
    await expect(firstActivity.locator('.activity-content').getByText(marker, { exact: true })).toBeVisible();
  await expect(firstActivity.locator('.tool-status.error')).toHaveText('Erreur');
  await expect.poll(visibleAgentHeadings).toBe(3);
  await mkdir(resolve('test-results'), { recursive: true });
  await page.screenshot({
    path: resolve('test-results', 'conversation-group-expanded.png'),
    animations: 'disabled',
  });
  checks.push(
    'Messages utilisateur et contexte délimitent les tours assistant : un en-tête chacun, raisonnement et outils regroupés',
  );
  checks.push(
    'Activité repliée par défaut ; tous les résultats, erreurs et raisonnements accessibles après dépliage',
  );

  await firstActivity.locator(':scope > summary').click();
  await page.locator('#composer').fill('Poursuis les étapes en direct.');
  await page.locator('#send-button').click();
  await expect.poll(() => controls.length).toBe(1);
  await controls[0].step(1);
  await expect(activities).toHaveCount(2);
  const liveActivity = activities.last();
  await expect.poll(visibleAgentHeadings).toBe(4);
  await liveActivity.locator(':scope > summary').click();
  await expect(liveActivity).toHaveAttribute('open', '');
  await controls[0].step(2, true);
  await expect(liveActivity.locator('.tool-block')).toHaveCount(2);
  await expect(liveActivity).toHaveAttribute('open', '');
  await expect.poll(visibleAgentHeadings).toBe(4);
  await liveActivity.locator(':scope > summary').click();
  await controls[0].step(3);
  await expect(liveActivity.locator('.tool-block')).toHaveCount(3);
  await expect(liveActivity).not.toHaveAttribute('open', '');
  await liveActivity.locator(':scope > summary').click();
  await page.reload();
  await expect(page.locator('#stop-button')).toBeVisible();
  await expect(activities).toHaveCount(2);
  await expect(activities.last().locator('.tool-block')).toHaveCount(3);
  await expect(activities.last()).not.toHaveAttribute('open', '');
  await expect.poll(visibleAgentHeadings).toBe(4);
  checks.push(
    'Regroupement sans doublons après rechargement, état de dépliage stable pendant les mises à jour et repli initial après rechargement',
  );
  for (const width of composerWidths) await assertToolbarFits(width, true);
  checks.push(
    'À 320, 390, 480, 760 et 1280 px pendant une exécution : composer compact, action carrée de 44 px et contrôles sur la même ligne sans chevauchement',
  );
  await controls[0].finish();
  await expect(page.locator('#stop-button')).toBeHidden();
  await expect(page.locator('#send-button')).toBeVisible();
  for (const width of composerWidths) await assertToolbarFits(width, false);
  for (const width of composerWidths) {
    const active = composerMeasurements.find((item) => item.width === width && item.active);
    const idle = composerMeasurements.find((item) => item.width === width && !item.active);
    expect(
      Math.abs(active.formHeight - idle.formHeight),
      `Send/stop changes form height at ${width}px`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(active.action.left - idle.action.left),
      `Send/stop changes horizontal action position at ${width}px`,
    ).toBeLessThanOrEqual(1);
  }
  checks.push(
    'Au repos : Envoyer remplace Arrêter dans le même emplacement, avec nom accessible et composer mobile vide ≤ 145 px',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const emptyTextHeight = await page
    .locator('#composer')
    .evaluate((node) => node.getBoundingClientRect().height);
  await page
    .locator('#composer')
    .fill(Array.from({ length: 12 }, (_, index) => `Ligne de brouillon ${index + 1}`).join('\n'));
  const expandedTextHeight = await page
    .locator('#composer')
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(expandedTextHeight).toBeGreaterThan(emptyTextHeight + 40);
  expect(expandedTextHeight).toBeLessThanOrEqual(200);
  await page
    .locator('#composer')
    .fill('Ce brouillon conserve son texte lorsque le téléphone change de sens. '.repeat(4));
  await page.setViewportSize({ width: 320, height: 844 });
  const narrowDraftHeight = await page
    .locator('#composer')
    .evaluate((node) => node.getBoundingClientRect().height);
  await page.setViewportSize({ width: 760, height: 844 });
  await expect
    .poll(() => page.locator('#composer').evaluate((node) => node.getBoundingClientRect().height))
    .toBeLessThan(narrowDraftHeight);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#composer').fill('');
  const collapsedTextHeight = await page
    .locator('#composer')
    .evaluate((node) => node.getBoundingClientRect().height);
  expect(collapsedTextHeight).toBeLessThanOrEqual(emptyTextHeight + 1);
  await expect(page.locator('#send-button')).toBeDisabled();
  checks.push(
    'La saisie grandit avec le brouillon, se recalcule à la rotation et retrouve sa hauteur compacte après effacement',
  );
  await expect(page.getByText('La réponse en direct est terminée.', { exact: true })).toBeVisible();
  await expect.poll(visibleAgentHeadings).toBe(4);
  expect(errors).toEqual([]);
  await writeFile(
    resolve('test-results', 'conversation-ui-report.json'),
    JSON.stringify({ passed: true, checks, composerMeasurements }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) {
  console.error(error);
  if (page) {
    await mkdir(resolve('test-results'), { recursive: true });
    await page
      .screenshot({ path: resolve('test-results', 'conversation-ui-failure.png'), animations: 'disabled' })
      .catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app.close();
  const cleanupPath = resolve(temp);
  if (
    !cleanupPath.startsWith(resolve(tmpdir()) + sep) ||
    !basename(cleanupPath).startsWith('prime-studio-conversation-')
  )
    throw new Error('Répertoire de test non reconnu : nettoyage refusé.');
  await rm(cleanupPath, { recursive: true, force: true });
}
