// Capture the real desktop UI with isolated, fictional data. No native agent is started.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../server.mjs';
import { createFileStore } from '../lib/files.mjs';
import { hashAccessCode } from '../lib/lan.mjs';
import { projectKey } from '../runtime/subagent-policy.mjs';
import { captureEnglishDocumentation } from './documentation-capture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs', 'screenshots');
const temp = await mkdtemp(join(tmpdir(), 'prime-readme-'));
const cwd = process.platform === 'win32' ? 'C:\\Projets\\Atelier' : '/projects/Atelier';
const timestamp = Date.now() - 20 * 60000;
const model = 'openai-codex/gpt-5.6-luna';
let serial = 0;
const message = (role, text, extra = {}) => ({
  id: `demo-message-${++serial}`,
  role,
  text,
  timestamp,
  tools: [],
  ...(role === 'assistant' ? { model: 'gpt-5.6-luna', provider: 'openai-codex' } : {}),
  ...extra,
});
const activity = (label, result, index) =>
  message('assistant', '', {
    thinking: label,
    tools: [
      {
        id: `demo-tool-${index}`,
        name: 'ipython',
        args: { code: `print(${JSON.stringify(result)})` },
        result,
        status: 'done',
      },
    ],
  });
const conversation = [
  message(
    'user',
    'Ajoute une recherche et des favoris au catalogue de modèles. Garde une interface simple, utilisable au clavier.',
  ),
  activity('Examiner le catalogue et les composants existants.', 'Catalogue et composants examinés.', 1),
  activity(
    'Vérifier la recherche, les favoris et la navigation au clavier.',
    'Les scénarios de démonstration sont terminés.',
    2,
  ),
  message(
    'assistant',
    [
      '## Vos modèles, plus faciles à retrouver',
      '',
      'La recherche et les favoris sont en place. Le sélecteur conserve le modèle choisi et distingue les fournisseurs.',
      '',
      '| Fonction | Comportement |',
      '| --- | --- |',
      '| Recherche | Nom, fournisseur ou identifiant |',
      '| Favoris | Vos modèles préférés en tête de liste |',
      '| Clavier | Tabulation, Entrée et Échap |',
      '',
      'Les préférences restent enregistrées dans ce navigateur. Vous pouvez reprendre le travail dans une autre session à tout moment.',
    ].join('\n'),
  ),
];
const sessions = [
  {
    id: 'demo-model-search',
    title: 'Recherche et favoris des modèles',
    pinned: true,
    messages: conversation,
  },
  {
    id: 'demo-accessibility',
    title: 'Améliorer la navigation au clavier',
    messages: [
      message('user', 'Vérifie la navigation au clavier.'),
      message(
        'assistant',
        'Les boutons disposent de libellés accessibles et les dialogues rendent le focus au déclencheur.',
      ),
    ],
  },
  {
    id: 'demo-tests',
    title: 'Tests du parcours de connexion',
    messages: [
      message('user', 'Prépare les tests du parcours de connexion.'),
      message('assistant', 'Le parcours couvre la connexion, les erreurs de saisie et la déconnexion.'),
    ],
  },
  {
    id: 'demo-docs',
    title: 'Documenter la première installation',
    messages: [
      message('user', 'Rédige le guide de démarrage du projet.'),
      message('assistant', 'Le guide présente les prérequis, le lancement et la configuration locale.'),
    ],
  },
].map((session, index) => ({
  ...session,
  cwd,
  model,
  messageCount: session.messages.length,
  createdAt: new Date(timestamp - index * 3600000).toISOString(),
  updatedAt: new Date(timestamp - index * 3600000).toISOString(),
}));
const projects = [
  { cwd, name: 'Atelier', pinned: true, exists: true, sessions },
  { cwd: cwd.replace('Atelier', 'Documentation'), name: 'Documentation', exists: true, sessions: [] },
  { cwd: cwd.replace('Atelier', 'Site-vitrine'), name: 'Site vitrine', exists: true, sessions: [] },
];
const store = {
  async overview() {
    return {
      projects: projects.map((project) => ({
        ...project,
        sessions: project.sessions.map(({ messages, ...summary }) => summary),
      })),
      totalSessions: sessions.length,
    };
  },
  async history(id) {
    const session = sessions.find((value) => value.id === id);
    assert.ok(session, 'Only demonstration sessions may be opened');
    return session;
  },
  async findProject(path) {
    const project = projects.find((project) => project.cwd === path);
    assert.ok(project, 'Only demonstration projects may be opened');
    return project;
  },
};
const models = [
  { id: model, name: 'GPT-5.6 Luna', provider: 'openai-codex', reasoning: true },
  { id: 'openai-codex/gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'openai-codex', reasoning: true },
  { id: 'openai-codex/gpt-5.5', name: 'GPT-5.5', provider: 'openai-codex', reasoning: true },
];
for (const model of models) model.thinkingLevels = ['off', 'low', 'medium', 'high', 'xhigh'];
const runtime = {
  async getStatus() {
    return { available: true, version: '0.9.2' };
  },
  async getModels() {
    return { models, default: { model: 'openai-codex/gpt-5.6-sol', thinking: 'high' } };
  },
  async start() {
    throw new Error('Screenshot fixtures cannot start an agent.');
  },
  async close() {},
};
await Promise.all(['agent', 'data', 'sessions'].map((name) => mkdir(join(temp, name), { recursive: true })));
await writeFile(
  join(temp, 'agent', 'settings.json'),
  JSON.stringify({ defaultProvider: 'openai-codex', defaultModel: 'gpt-5.6-sol' }),
);
await writeFile(
  join(temp, 'data', 'subagent-defaults.json'),
  JSON.stringify({
    version: 1,
    revision: 'demo',
    global: { model, thinking: 'high' },
    projects: { [projectKey(cwd)]: { model, thinking: 'medium' } },
  }),
);
const salt = 'a'.repeat(32);
await writeFile(
  join(temp, 'data', 'lan-access.json'),
  JSON.stringify({
    enabled: true,
    host: '192.168.1.50',
    port: 3089,
    readOnly: false,
    salt,
    codeHash: hashAccessCode('12345678', salt),
  }),
);
const app = createApp({
  store,
  runtime,
  agentHome: join(temp, 'agent'),
  dataDir: join(temp, 'data'),
  sessionDir: join(temp, 'sessions'),
  liveClient: {
    async getSnapshot() {
      return {
        available: true,
        steering: ['Conserve aussi les raccourcis clavier existants.'],
        followUps: ['Ajoute un exemple au guide de démarrage.'],
      };
    },
  },
});
await mkdir(output, { recursive: true });
await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${app.server.address().port}`;
let browser;
const errors = [],
  captures = [];
try {
  browser = await chromium.launch({ channel: process.env.PRIME_STUDIO_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'fr-FR',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    assert.equal(new URL(request.url()).origin, url, 'Screenshots must use only the isolated server');
    assert.equal(request.method(), 'GET', 'Screenshot generation must not mutate application data');
  });
  await page.addInitScript(
    ({ cwd, model }) => {
      localStorage.setItem(
        'prime-studio.selection',
        JSON.stringify({ cwd, sessionId: 'demo-model-search', projectOverview: false }),
      );
      localStorage.setItem(
        'prime-studio.preferences',
        JSON.stringify({ theme: 'dark', details: true, modelFavorites: [model, 'openai-codex/gpt-5.6-sol'] }),
      );
    },
    { cwd, model },
  );
  async function capture(name, target = page) {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1590, 990);
    if (!(await captureEnglishDocumentation(page, name, target)))
      await target.screenshot({ path: join(output, name), animations: 'disabled' });
    captures.push(name);
  }
  await page.goto(url);
  await expect(page.locator('#header-session')).toHaveText(sessions[0].title);
  await expect(page.locator('.activity-stack')).toBeVisible();
  await expect(page.locator('#connection-label')).toHaveText('Moteur connecté');
  await capture('desktop-conversation.png');

  await page.locator('#model-picker-button').click();
  await expect(page.locator('#model-search')).toBeFocused();
  await expect(page.locator('#model-favorites-label')).toContainText('2');
  await capture('desktop-models.png', page.locator('#model-dialog'));
  await page.keyboard.press('Escape');

  await page.locator('#open-settings').click();
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.locator('#language-select').selectOption('en');
  await expect(page.locator('#open-model-config')).toHaveText('Configure');
  await capture('desktop-language.png', page.locator('#settings-dialog'));
  await page.locator('#language-select').selectOption('fr');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.locator('#open-model-config').click();
  await expect(page.locator('#default-main-model')).toContainText('GPT-5.6 Sol');
  await expect(page.locator('#default-subagent-model')).toContainText('GPT-5.6 Luna');
  await capture('desktop-model-defaults.png', page.locator('#model-config-dialog'));
  await page.keyboard.press('Escape');
  await page.locator('#new-session').click();
  await page.locator('#inspector-tab-agents').click();
  await expect(page.locator('#project-subagent-model')).toBeVisible();
  await expect(page.locator('#project-subagent-thinking')).toHaveValue('medium');
  await expect(page.locator('#detail-session-id')).toBeHidden();
  await capture('desktop-new-conversation-agents.png');
  await page.locator('#inspector-tab-session').click();
  await page.locator('#open-settings').click();
  await page.locator('#open-remote-access').click();
  await expect(page.locator('#remote-code')).toBeEnabled();
  await capture('desktop-remote-pin.png', page.locator('#remote-access-dialog'));
  await page.keyboard.press('Escape');

  await page.locator('#open-settings').click();
  await page.locator('[data-theme-choice="light"]').click();
  await page.keyboard.press('Escape');
  await page.locator('#header-project').click();
  await expect(page.locator('#project-overview')).toBeVisible();
  await expect(page.locator('.project-session-card')).toHaveCount(4);
  await capture('desktop-projects.png');

  // Seed only this isolated server's SSE replay to show the actual active-turn controls.
  const startedAt = new Date(Date.now() - 84000).toISOString();
  sessions[0].updatedAt = startedAt;
  // Show a fresh demonstration turn, without older content above it.
  sessions[0].messages = [];
  sessions[0].messageCount = 0;
  const run = {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: sessions[0].id,
    cwd,
    status: 'running',
    model,
    thinking: 'high',
    prompt: 'Vérifie maintenant les derniers détails de navigation.',
    startedAt,
    seq: 0,
    events: [],
    clients: new Set(),
    finished: false,
    bytes: 0,
  };
  const events = [
    {
      kind: 'message',
      message: message(
        'assistant',
        'La recherche et les favoris sont vérifiés. Je termine les contrôles de navigation au clavier et la documentation.',
        { timestamp: Date.parse(startedAt) + 15000 },
      ),
    },
    {
      kind: 'message',
      message: message('assistant', '', {
        timestamp: Date.parse(startedAt) + 30000,
        thinking: 'Contrôler le retour du focus après fermeture du sélecteur.',
        tools: [
          {
            id: 'demo-running-tool',
            name: 'ipython',
            status: 'running',
            args: { code: 'verify_keyboard_navigation()' },
          },
        ],
      }),
    },
  ];
  run.events = events.map((event) => {
    const item = { ...event, seq: ++run.seq };
    return { item, wire: `id: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n` };
  });
  app.runs.set(run.id, run);
  await page.goto(url);
  await expect(page.locator('#stop-button')).toBeVisible();
  await expect(page.locator('.live-queue-count')).toHaveText('2');
  await page.locator('#composer').fill('Vérifie aussi le retour du focus après fermeture du sélecteur.');
  await expect(page.locator('#send-button')).toBeEnabled();
  await page.locator('.live-queue > summary').click();
  await expect(page.locator('#messages')).toContainText('Je termine les contrôles de navigation');
  await expect(page.locator('.activity-stack.is-running')).toBeVisible();
  await expect(page.locator('.activity-stack.is-running')).toBeInViewport();
  await capture('desktop-live-messages.png');

  // Display genuine image/file rendering and upload previews using only our fixture files.
  app.runs.delete(run.id);
  const fileStore = createFileStore(join(temp, 'data', 'attachments'));
  const brief = Buffer.from('# Atelier\n\nConserver les couleurs et simplifier la navigation.\n');
  const [attachment] = await fileStore.save([{ name: 'brief-du-projet.md', data: brief.toString('base64') }]);
  const picture = await readFile(join(root, 'assets', 'prime-agent.png'));
  sessions[0].title = 'Images et fichiers pour le projet';
  sessions[0].messages = [
    message('user', 'Voici le logo et le brief du projet. Prépare les prochaines étapes.', {
      attachments: [
        { type: 'image', mimeType: 'image/png', data: picture.toString('base64') },
        { type: 'file', id: attachment.id, name: attachment.name, size: attachment.size },
      ],
    }),
    message(
      'assistant',
      [
        '## Une base commune pour la suite',
        '',
        'Le logo et le brief sont prêts à guider le travail sur l’interface.',
        '',
        '- Reprendre les couleurs du logo dans les éléments de navigation.',
        '- Définir les écrans prioritaires à partir du brief.',
        '- Vérifier les parcours sur PC et sur mobile.',
      ].join('\n'),
    ),
  ];
  sessions[0].messageCount = sessions[0].messages.length;
  await page.goto(url);
  await expect(page.locator('#header-session')).toHaveText(sessions[0].title);
  await expect(page.locator('.message-image')).toBeVisible();
  await expect(page.locator('.message-file')).toHaveText('brief-du-projet.md');
  await expect(page.locator('#attach-images')).toBeEnabled();
  await page
    .locator('#image-files')
    .setInputFiles({ name: 'logo-projet.png', mimeType: 'image/png', buffer: picture });
  await page
    .locator('#attachment-files')
    .setInputFiles({ name: 'notes-de-relecture.md', mimeType: 'text/markdown', buffer: brief });
  await expect(page.locator('.image-draft')).toHaveCount(2);
  await page.locator('#composer').fill('Voici les éléments pour la prochaine itération.');
  await expect(page.locator('#send-button')).toBeEnabled();
  await capture('desktop-attachments.png');
  assert.deepEqual(errors, []);
  await mkdir(join(root, 'test-results'), { recursive: true });
  await writeFile(
    join(root, 'test-results', 'readme-captures.json'),
    JSON.stringify(
      {
        captures,
        viewport: { width: 1600, height: 1000 },
        fictionalData: true,
        nativeAgentsStarted: 0,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ captures, errors }));
} finally {
  await browser?.close();
  await app.close();
  const safe = resolve(temp);
  assert.ok(safe.startsWith(resolve(tmpdir()) + sep) && safe.includes('prime-readme-'));
  await rm(safe, { recursive: true, force: true });
}
