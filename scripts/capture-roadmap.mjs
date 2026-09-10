// Real Studio rendering with an isolated fictional project. No provider or user data.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../server.mjs';

const browser = await chromium.launch({
  channel: process.env.PRIME_STUDIO_BROWSER || 'chrome',
  headless: true,
});
const reports = [];
try {
  for (const fr of [true, false]) {
    const text = (a, b) => (fr ? a : b);
    const root = await mkdtemp(join(tmpdir(), 'studio-roadmap-capture-'));
    const cwd = join(root, text('Projet de démonstration', 'Demo project'));
    const agentHome = join(root, 'agent');
    const sessionDir = join(root, 'sessions');
    const dataDir = join(root, 'data');
    await Promise.all([cwd, agentHome, sessionDir, dataDir].map((path) => mkdir(path, { recursive: true })));
    let modelCalls = 0;
    const app = createApp({
      initialCwd: cwd,
      agentHome,
      sessionDir,
      dataDir,
      runtime: {
        getStatus: async () => ({ available: true, version: 'demo' }),
        getModels: async () => ({ models: [], default: {} }),
        start: async () => {
          modelCalls++;
          throw new Error('Screenshots cannot launch an agent');
        },
        close: async () => {},
      },
    });
    let page;
    try {
      await app.store.project({ cwd });
      let doc = await app.roadmap.read(cwd);
      const change = async (action, params = {}) =>
        (doc = await app.roadmap.mutate(cwd, { action, expectedRevision: doc.revision, ...params }));
      await change('init');
      await change('vision', {
        text: text(
          'Créer une application de notes claire, agréable et accessible sur tous les écrans.',
          'Build a clear, welcoming notes app that works across screen sizes.',
        ),
      });
      await change('milestone.create', {
        title: text('Une première version prête à essayer', 'A first version ready to try'),
        status: 'active',
      });
      await change('plan.create', {
        title: text('Construire le parcours essentiel', 'Build the core experience'),
        milestone: doc.overview.milestones[0].id,
        summary: text(
          'De la première note à la recherche, garder un parcours simple et cohérent.',
          'From the first note to search, keep the experience simple and consistent.',
        ),
        steps: [
          {
            text: text('Définir les bases du produit', 'Define the product foundations'),
            children: [
              { text: text('Décrire les usages principaux', 'Describe the main use cases'), done: true },
              { text: text('Dessiner le parcours de création', 'Sketch the creation flow'), done: true },
              {
                text: text('Choisir une hiérarchie visuelle sobre', 'Choose a restrained visual hierarchy'),
                done: true,
              },
            ],
          },
          {
            text: text('Créer et retrouver ses notes', 'Create and find notes'),
            children: [
              {
                text: text('Ajouter une note avec un titre et du texte', 'Add a note with a title and text'),
                done: true,
              },
              {
                text: text('Retrouver une note avec la recherche', 'Find a note through search'),
                note: text(
                  'Rechercher dans les titres et le contenu. Prévoir un état vide utile lorsqu’aucun résultat ne correspond.',
                  'Search titles and content. Provide a useful empty state when no results match.',
                ),
              },
              { text: text('Classer les notes par collection', 'Organize notes into collections') },
            ],
          },
          {
            text: text('Vérifier le confort d’utilisation', 'Check everyday usability'),
            children: [
              {
                text: text('Parcourir les écrans au clavier', 'Navigate screens with the keyboard'),
                done: true,
              },
              { text: text('Tester la lecture sur téléphone', 'Test reading on a phone') },
              { text: text('Contrôler les états vides et les erreurs', 'Review empty and error states') },
            ],
          },
        ],
      });
      const plan = doc.plans[0];
      await change('plan.create', {
        title: text('Préparer la publication', 'Prepare the release'),
        milestone: doc.overview.milestones[0].id,
        steps: [
          { text: text('Rédiger un guide de démarrage', 'Write a getting-started guide') },
          { text: text('Recueillir les premiers retours', 'Collect initial feedback') },
        ],
      });
      await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
      page = await browser.newPage({
        locale: fr ? 'fr-FR' : 'en-US',
        viewport: { width: 1600, height: 1200 },
        deviceScaleFactor: 1,
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(
        (cwd) => localStorage.setItem('prime-studio.selection', JSON.stringify({ cwd })),
        cwd,
      );
      await page.goto(`http://127.0.0.1:${app.server.address().port}`);
      await page.locator('#open-roadmap').click();
      const panel = page.locator('#roadmap-panel');
      await panel.locator('.rm-expand').click();
      await expect(page.locator('body')).toHaveClass(/roadmap-expanded/);
      const first = panel.locator(`.rm-plan[data-plan-id="${plan.id}"]`);
      const toggle = first.locator(':scope > .rm-plan-head > .rm-plan-toggle');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      for (const step of [plan.steps[0], plan.steps[2]]) {
        const toggle = first.locator(`.rm-step[data-step-id="${step.id}"] .rm-step-toggle`).first();
        if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
      }
      const note = plan.steps[1].children[1];
      await first.locator(`.rm-step[data-step-id="${note.id}"] .rm-description-toggle`).click();
      await expect(panel).toContainText('5/11');
      await page.mouse.move(20, 20);
      await page.evaluate(() => document.fonts.ready);
      const output = resolve('docs/screenshots', fr ? '' : 'en', 'roadmap-expanded.png');
      await mkdir(dirname(output), { recursive: true });
      await panel.screenshot({ path: output, animations: 'disabled' });
      assert.deepEqual(errors, []);
      assert.equal(modelCalls, 0);
      reports.push({ language: fr ? 'fr' : 'en', screenshot: output, syntheticData: true, modelCalls });
    } finally {
      await page?.close();
      await app.close();
      assert.equal(dirname(root), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    }
  }
} finally {
  await browser.close();
}
await mkdir('test-results', { recursive: true });
await writeFile('test-results/roadmap-captures.json', JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
