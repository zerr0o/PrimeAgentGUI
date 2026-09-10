import { createKnowledgeFixture } from './knowledge.mjs';
import { createApp } from '../../server.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// Real Studio routes/storage, synthetic conversations and no provider calls.
export async function createRoadmapFixture({ empty = false } = {}) {
  const calls = [];
  const fixture = await createKnowledgeFixture({
    createApplication(options) {
      return createApp({
        ...options,
        readInspectorEdges: async () => [
          {
            parent: join(options.sessionDir, 'sounds', 'calibration-demo.jsonl'),
            childId: 'audio-research',
            childSessionId: 'child-closed',
            name: 'Recherche sur la convolution',
            child: join(
              options.sessionDir,
              'session-artifacts',
              'calibration-demo',
              'sub-audio-research',
              'child-closed.jsonl',
            ),
          },
        ],
        runtime: {
          ...options.runtime,
          getModels: async () => ({
            models: [
              {
                id: 'test/roadmap',
                name: 'Agent de démonstration',
                provider: 'test',
                availability: 'available',
              },
            ],
            default: { model: 'test/roadmap', thinking: 'medium' },
          }),
          async start(input) {
            calls.push(input);
            const sessionId = input.sessionId || randomUUID();
            if (!input.sessionId) {
              const bucket = join(options.sessionDir, 'roadmap');
              await mkdir(bucket, { recursive: true });
              await writeFile(
                join(bucket, `${sessionId}.jsonl`),
                [
                  { type: 'session', id: sessionId, cwd: input.cwd, timestamp: new Date().toISOString() },
                  {
                    type: 'message',
                    id: 'request',
                    message: { role: 'user', content: input.message },
                    timestamp: new Date().toISOString(),
                  },
                  {
                    type: 'message',
                    id: 'response',
                    parentId: 'request',
                    message: {
                      role: 'assistant',
                      content: 'Le travail a été reçu dans cette conversation de démonstration.',
                      stopReason: 'stop',
                    },
                    timestamp: new Date().toISOString(),
                  },
                ]
                  .map(JSON.stringify)
                  .join('\n') + '\n',
              );
            }
            input.onEvent({ kind: 'session', sessionId });
            return { done: Promise.resolve({}), cancel: async () => {} };
          },
        },
      });
    },
  });
  if (!empty) {
    let doc = await fixture.app.roadmap.read(fixture.cwd);
    const change = async (action, params) =>
      (doc = await fixture.app.roadmap.mutate(fixture.cwd, {
        action,
        expectedRevision: doc.revision,
        ...params,
      }));
    await change('init');
    await change('vision', {
      text: 'Rendre la calibration sonore sur PC fiable, mesurable et simple à utiliser.',
    });
    await change('milestone.create', {
      title: 'Une calibration reproductible',
      status: 'active',
      summary: 'Valider les mesures et retrouver les décisions dans leurs conversations.',
    });
    const milestone = doc.overview.milestones[0].id;
    await change('plan.create', {
      title: 'Fiabiliser le parcours de mesure',
      milestone,
      summary: 'Du microphone au rapport final, conserver une méthode vérifiable.',
      sessions: ['calibration-demo'],
      steps: [
        { text: 'Préparer le protocole de mesure', done: true, note: 'Fréquence de référence : 48 kHz.' },
        {
          text: 'Vérifier les canaux audio',
          children: [
            { text: 'Mesurer le canal gauche', done: true },
            { text: 'Mesurer le canal droit', note: 'Comparer avec la mesure de référence.' },
          ],
        },
        { text: 'Conserver le rapport de validation' },
      ],
    });
    await change('journal.add', {
      planId: doc.plans[0].id,
      text: 'Le protocole est documenté. Les mesures du canal droit restent à confirmer.',
    });
    await change('plan.create', {
      title: 'Préparer la distribution Windows',
      milestone,
      status: 'paused',
      steps: [{ text: 'Tester une installation propre' }, { text: 'Documenter la mise à jour' }],
    });
    await change('milestone.create', { title: 'Prise en main et documentation', status: 'planned' });
    await change('plan.create', {
      title: 'Accompagner la première calibration',
      milestone: doc.overview.milestones[1].id,
      steps: [{ text: 'Rédiger le guide de démarrage' }],
    });
    await change('backlog.add', {
      items: [
        { text: 'Comparer deux profils de calibration', note: 'Conserver le même niveau sonore.' },
        { text: 'Tester le parcours depuis un téléphone' },
      ],
      notes: [
        { text: 'Exporter un compte rendu partageable', note: 'Explorer un format lisible sans le Studio.' },
      ],
    });
  }
  return { ...fixture, calls };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await createRoadmapFixture();
  await mkdir(resolve('.local'), { recursive: true });
  await writeFile(
    resolve('.local/roadmap-preview.json'),
    JSON.stringify({ url: fixture.url, cwd: fixture.cwd, pid: process.pid, root: fixture.root }),
  );
  console.log(JSON.stringify({ url: fixture.url, pid: process.pid }));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await fixture.close();
      process.exit();
    });
}
