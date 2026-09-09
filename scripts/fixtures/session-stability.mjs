// Isolated, synthetic conversations. No user settings, native daemon or provider is used.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createApp } from '../../server.mjs';

export async function createStabilityFixture() {
  const root = await mkdtemp(join(tmpdir(), 'prime-studio-stability-ui-'));
  const cwd = join(root, 'SoundsPerfect'),
    sessionDir = join(root, 'sessions');
  await Promise.all(
    [cwd, sessionDir, join(root, 'Atelier'), join(root, 'Documentation')].map((p) => mkdir(p)),
  );
  const entries = [
    { type: 'session', id: 'stability-demo', cwd, timestamp: new Date(Date.now() - 1800000).toISOString() },
  ];
  const add = (message, type = 'message') => {
    const id = `entry-${entries.length}`;
    entries.push({
      type,
      id,
      parentId: entries.at(-1).id,
      timestamp: new Date(Date.now() - 600000 + entries.length * 60000).toISOString(),
      ...(type === 'message' ? { message } : { ...message }),
    });
  };
  add({
    role: 'user',
    content:
      'Étudions la calibration sonore sur PC. Vérifie l’interface et la distribution avec deux sous-agents.',
  });
  add({
    role: 'assistant',
    content: 'Je coordonne les vérifications de l’interface et de l’installeur.',
    stopReason: 'stop',
  });
  add(
    {
      customType: 'agent_message',
      display: true,
      content: 'Native envelope',
      details: {
        id: 'agentmsg_ui_fixture',
        fromRelationship: 'child',
        from: { sessionName: 'native-ui-test-driver', sessionId: '01a082a2-fbce-72cf-ba56-843cdfe569e1' },
        target: { sessionId: 'stability-demo' },
        message:
          'Le pilote d’interface est prêt. Les événements **UI Automation** et le suivi des fichiers répondent correctement.\n\nLe test de démarrage est en cours ; je transmettrai les captures après vérification.',
      },
    },
    'custom_message',
  );
  add({ role: 'assistant', content: [], stopReason: 'stop' });
  add(
    {
      customType: 'agent_message',
      display: true,
      content: 'Native envelope',
      details: {
        id: 'agentmsg_build_fixture',
        fromRelationship: 'child',
        from: { sessionName: 'build-distribution', sessionId: '01a08268-a2bc-734f-9043-dfa2dc627233' },
        target: { sessionId: 'stability-demo' },
        message:
          'L’audit de distribution est terminé : le raccourci Windows ouvre le bon dossier et les dépendances sont présentes.\n\nAucune nouvelle publication n’a été lancée.',
      },
    },
    'custom_message',
  );
  add({ role: 'assistant', content: [], stopReason: 'stop' });
  await writeFile(join(sessionDir, 'demo.jsonl'), entries.map(JSON.stringify).join('\n') + '\n');
  let control;
  const runtime = {
    getStatus: async () => ({ available: true, version: 'fixture' }),
    getModels: async () => ({
      models: [{ id: 'fixture/astra', name: 'GPT-6 Astra', provider: 'fixture', reasoning: true }],
      default: { model: 'fixture/astra' },
    }),
    async start(input) {
      let finish;
      const done = new Promise((resolve) => {
        finish = resolve;
      });
      control = {
        done,
        cancel() {
          const result = { kind: 'done', status: 'stopped', code: 130, sessionId: 'stability-demo' };
          input.onEvent(result);
          finish(result);
        },
      };
      return control;
    },
    async close() {
      control?.cancel();
    },
  };
  const queues = {
    steering: [
      'Agent message received: Scenario.cs converti en UTF-8. Vérification exacte effectuée, garde SYNTHÉTIQUE conservée. Aucun build lancé.',
      'Agent message received: Les panneaux utilisent des conteneurs accessibles. Modification ciblée en cours ; attends mon signal avant le build.',
    ],
    followUps: ['Ajoute un récapitulatif des vérifications à la fin.'],
  };
  const snapshot = () => ({ available: true, ...structuredClone(queues) });
  const liveClient = {
    async getSnapshot() {
      return snapshot();
    },
    async mutate(id, cwd, input) {
      const lane = input.lane === 'steering' ? 'steering' : 'followUps',
        list = queues[lane];
      assert.equal(list[input.index], input.expectedText);
      if (input.mutation.type === 'delete') list.splice(input.index, 1);
      else if (input.mutation.type === 'replace') list[input.index] = input.mutation.text;
      else {
        const next = input.index + input.mutation.direction;
        [list[input.index], list[next]] = [list[next], list[input.index]];
      }
      return { changed: true, snapshot: snapshot() };
    },
  };
  const app = createApp({
    runtime,
    liveClient,
    sessionDir,
    agentHome: join(root, 'agent'),
    dataDir: join(root, 'data'),
    initialCwd: cwd,
  });
  await app.store.project({ cwd: join(root, 'Atelier') });
  await app.store.project({ cwd: join(root, 'Documentation') });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const result = await fetch(url + '/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url },
    body: JSON.stringify({
      cwd,
      sessionId: 'stability-demo',
      message: 'Finalise les contrôles et prépare la synthèse.',
    }),
  });
  assert.equal(result.status, 201, await result.text());
  return {
    url,
    cwd,
    root,
    app,
    async close() {
      await app.close();
      assert.equal(dirname(root), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await createStabilityFixture();
  await mkdir(resolve('.local'), { recursive: true });
  await writeFile(
    resolve('.local/session-stability-preview.json'),
    JSON.stringify({ url: fixture.url, cwd: fixture.cwd, pid: process.pid }, null, 2),
  );
  console.log(JSON.stringify({ url: fixture.url, pid: process.pid }));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await fixture.close();
      process.exit();
    });
}
