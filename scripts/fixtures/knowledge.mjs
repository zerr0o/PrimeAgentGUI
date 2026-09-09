import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createApp } from '../../server.mjs';

// All content is synthetic. The fixture never opens the user's native agent home.
export async function createKnowledgeFixture({ longHistory = false, createApplication = createApp } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'prime-studio-v3-ui-'));
  const agentHome = join(root, 'agent'),
    sessionDir = join(agentHome, 'sessions');
  const bucket = join(sessionDir, 'sounds'),
    cwd = join(root, 'SoundsPerfect');
  const otherCwd = join(root, 'Vtrott'),
    dataDir = join(root, 'studio');
  for (const path of [cwd, otherCwd, join(root, 'OmnicastVR'), bucket, join(agentHome, 'harness')])
    await mkdir(path, { recursive: true });
  const before = {
    id: 'calibration',
    title: 'Validation audio',
    content: 'Vérifier le filtre avant distribution.',
    version: 1,
    scope: 'session',
  };
  const after = {
    ...before,
    content:
      'Valider le filtre à 48 kHz, mesurer la réponse impulsionnelle et conserver le rapport de mesure.',
    version: 2,
    updated_at: '2026-09-08T16:00:00Z',
  };
  const refinement = {
    id: 'refine-audio-2',
    summary: 'Préciser la validation des filtres audio',
    rationale: 'Le contrôle initial ne précisait ni la fréquence ni les preuves à conserver.',
    expectedOutcome: 'Des vérifications reproductibles à chaque nouvelle calibration.',
    appliedEdits: [{ action: 'update', kind: 'memory', id: 'calibration', applied: true, before, after }],
  };
  const sessions = [
    [
      'calibration-demo',
      'Calibrer la sortie audio à 48 kHz',
      'La calibration utilise une réponse impulsionnelle mesurée à **48 kHz**. Le rapport final confirme la stabilité des canaux gauche et droit.',
    ],
    [
      'filter-export',
      'Exporter les filtres pour Equalizer APO',
      'Pour exporter, conserver les canaux indépendants et documenter le gain maximal. Le filtre doit rester au format WAV.',
    ],
    [
      'interface-audio',
      'Vérifier l’interface de calibration',
      'Les commandes de lecture répondent au clavier et affichent la fréquence active.',
    ],
    [
      'installer-audio',
      'Préparer la distribution Windows',
      'Le raccourci pointe vers le dossier installé. Les bibliothèques audio sont présentes.',
    ],
    [
      'measurements-audio',
      'Comparer les dernières mesures',
      'La mesure de référence est conservée avec les filtres de chaque canal.',
    ],
    [
      'docs-audio',
      'Documenter le protocole de mesure',
      'La documentation décrit le microphone, son emplacement et le niveau sonore.',
    ],
    [
      'latency-audio',
      'Réduire la latence de lecture',
      'Le tampon audio peut être réduit lorsque la charge du processeur reste stable.',
    ],
  ];
  for (let index = 0; index < sessions.length; index++) {
    const [id, title, answer] = sessions[index];
    const timestamp = new Date(Date.UTC(2026, 8, 8, 15 - index)).toISOString();
    const entries = [
      { type: 'session', id, cwd, timestamp },
      { type: 'session_info', id: `${id}-name`, parentId: null, name: title, timestamp },
      {
        type: 'message',
        id: `${id}-user`,
        parentId: `${id}-name`,
        timestamp,
        message: { role: 'user', content: title },
      },
      {
        type: 'message',
        id: `${id}-answer`,
        parentId: `${id}-user`,
        timestamp,
        message: { role: 'assistant', content: answer, stopReason: 'stop' },
      },
    ];
    if (index === 0)
      entries.push({
        type: 'custom',
        customType: 'prime-agent.refinement',
        id: 'refinement-entry',
        parentId: `${id}-answer`,
        timestamp: '2026-09-08T16:00:00Z',
        data: refinement,
      });
    if (index === 0 && longHistory) {
      for (let follow = 0; follow < 70; follow++)
        entries.push({
          type: 'message',
          id: `later-${follow}`,
          parentId: entries.at(-1).id,
          timestamp: '2026-09-08T17:00:00Z',
          message: {
            role: follow % 2 ? 'assistant' : 'user',
            content:
              `Compte rendu ultérieur ${follow}. ` +
              'La vérification de cette étape est conservée dans la conversation. '.repeat(7),
            stopReason: 'stop',
          },
        });
    }
    await writeFile(join(bucket, `${id}.jsonl`), entries.map(JSON.stringify).join('\n') + '\n');
  }
  const artifact = join(sessionDir, 'session-artifacts', 'calibration-demo');
  await mkdir(join(artifact, 'harness'), { recursive: true });
  await writeFile(
    join(artifact, 'harness', 'harness_state.json'),
    JSON.stringify({ entries: { memory: { calibration: after } } }),
  );
  await mkdir(join(artifact, 'sub-audio-research'), { recursive: true });
  await writeFile(
    join(artifact, 'sub-audio-research', 'child-closed.jsonl'),
    [
      { type: 'session', id: 'child-closed', cwd, timestamp: '2026-09-08T14:30:00Z' },
      {
        type: 'session_info',
        id: 'child-name',
        parentId: null,
        name: 'Recherche sur la convolution',
        timestamp: '2026-09-08T14:30:00Z',
      },
      {
        type: 'message',
        id: 'child-answer',
        parentId: 'child-name',
        timestamp: '2026-09-08T14:31:00Z',
        message: {
          role: 'assistant',
          content:
            'La convolution applique le filtre mesuré sans perdre la correction de phase. Vérification terminée par le sous-agent.',
          stopReason: 'stop',
        },
      },
    ]
      .map(JSON.stringify)
      .join('\n') + '\n',
  );
  await writeFile(
    join(agentHome, 'harness', 'harness_state.json'),
    JSON.stringify({
      entries: {
        memory: {
          'windows-launch': {
            id: 'windows-launch',
            title: 'Lancements Windows discrets',
            content: 'Les utilitaires en arrière-plan doivent démarrer sans prendre le focus.',
            version: 1,
            scope: 'global',
            created_at: '2026-09-07T09:00:00Z',
          },
        },
      },
    }),
  );
  await writeFile(
    join(bucket, 'other.jsonl'),
    [
      { type: 'session', id: 'other-project', cwd: otherCwd, timestamp: '2026-09-08T16:00:00Z' },
      {
        type: 'message',
        id: 'other-user',
        parentId: null,
        message: { role: 'user', content: 'Planifier la migration du volant' },
      },
      {
        type: 'message',
        id: 'other-answer',
        parentId: 'other-user',
        message: { role: 'assistant', content: 'PROJECT_BOUNDARY_SENTINEL', stopReason: 'stop' },
      },
    ]
      .map(JSON.stringify)
      .join('\n') + '\n',
  );
  const app = createApplication({
    agentHome,
    sessionDir,
    dataDir,
    initialCwd: cwd,
    runtime: {
      getStatus: async () => ({ available: true, version: 'fixture', nodeVersion: process.versions.node }),
      getModels: async () => ({ models: [], default: {} }),
      close: async () => {},
    },
  });
  await app.store.project({ cwd });
  await app.store.project({ cwd: otherCwd });
  await app.store.project({ cwd: join(root, 'OmnicastVR') });
  await app.store.project({ cwd, pinned: true }, true);
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  return {
    root,
    app,
    cwd,
    otherCwd,
    agentHome,
    sessionDir,
    dataDir,
    url: `http://127.0.0.1:${app.server.address().port}`,
    async close() {
      await app.close();
      assert.equal(dirname(root), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await createKnowledgeFixture();
  await mkdir(resolve('.local'), { recursive: true });
  await writeFile(
    resolve('.local/v3-preview.json'),
    JSON.stringify({ url: fixture.url, cwd: fixture.cwd, pid: process.pid, root: fixture.root }),
  );
  console.log(JSON.stringify({ url: fixture.url, pid: process.pid }));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await fixture.close();
      process.exit();
    });
}
