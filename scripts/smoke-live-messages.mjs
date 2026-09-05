// Opt-in native integration: local fake provider, real Prime Agent and Python tool.
// Never uses the user's provider account, daemon, project or session directory.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentRuntime, discoverCli } from '../lib/agent.mjs';
import { createStore } from '../lib/store.mjs';
import { createFileStore, appendFileMessage, splitFileMessage } from '../lib/files.mjs';
import { imageMessageText } from '../lib/images.mjs';

if (!process.argv.includes('--run-native')) {
  console.log('Test natif isolé : node scripts/smoke-live-messages.mjs --run-native');
  process.exit(0);
}
const { createLiveSessionClient } = await import('../lib/live-session-client.mjs');
const cli = discoverCli();
assert.ok(cli?.packageDir, 'Prime Agent doit être installé pour ce test natif.');
const root = fileURLToPath(new URL('..', import.meta.url));
const smokeRoot = resolve(root, '.local', 'live-message-smoke');
const withAttachments = process.argv.includes('--attachments');
const directory = withAttachments
  ? await mkdtemp(join(tmpdir(), 'pimg-'))
  : join(smokeRoot, `${Date.now()}-${randomUUID().slice(0, 8)}`);
const cwd = join(directory, 'project');
const agentDir = join(directory, 'agent');
const sessionDir = join(agentDir, 'sessions');
const gateStarted = join(cwd, 'tool-started.txt');
const gateRelease = join(cwd, 'release-tool.txt');
const gateFinished = join(cwd, 'tool-finished.txt');
const reportPath = join(directory, 'report.json');
const report = { at: new Date().toISOString(), passed: false, directory, checks: [], requests: [] };
const images = withAttachments
  ? [
      {
        type: 'image',
        mimeType: 'image/png',
        data: (await readFile(join(root, 'assets', 'prime-agent.png'))).toString('base64'),
      },
    ]
  : [];
const fileStore = createFileStore(join(directory, 'uploads'));
const uploaded = withAttachments
  ? await fileStore.save([
      { name: 'essai avec espaces.txt', data: Buffer.from('NATIVE_FILE_CONTENT').toString('base64') },
    ])
  : [];
const original = 'BRIDGE_ROOT';
const steeringOriginal = 'BRIDGE_STEER_ORIGINAL';
const steeringEdited = 'BRIDGE_STEER_EDITED';
const followOriginal = 'BRIDGE_FOLLOW_ORIGINAL';
const followEdited = 'BRIDGE_FOLLOW_EDITED';
const followDeleted = 'BRIDGE_FOLLOW_DELETE';
const followLast = 'BRIDGE_FOLLOW_LAST';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((part) => part?.type === 'text')
          .map((part) => part.text || '')
          .join('\n')
      : '';
const inside = (path) => resolve(path).startsWith(resolve(directory) + sep);
async function exists(path) {
  return readFile(path).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
}
async function within(promise, timeout, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Délai dépassé : ${description}`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(check, timeout, description) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(75);
  }
  throw new Error(`Délai dépassé : ${description}`);
}
async function findDescriptor(sessionId) {
  const workers = join(agentDir, 'daemon-workers');
  for (const namespace of await readdir(workers, { withFileTypes: true }).catch(() => [])) {
    if (!namespace.isDirectory()) continue;
    const folder = join(workers, namespace.name);
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (!item.isFile() || !/^[a-f0-9]+\.json$/.test(item.name)) continue;
      const descriptor = JSON.parse(await readFile(join(folder, item.name), 'utf8'));
      if (descriptor.rootSessionId === sessionId) return descriptor;
      const path = descriptor.sessionFile || descriptor.createCommand?.sessionPath;
      if (!path || !inside(path)) continue;
      const header = (await readFile(path, 'utf8')).split('\n').find(Boolean);
      if (header && JSON.parse(header).id === sessionId) return descriptor;
    }
  }
  return null;
}
await Promise.all([mkdir(cwd, { recursive: true }), mkdir(sessionDir, { recursive: true })]);
const gateCode = [
  'from pathlib import Path',
  'import time',
  ...(withAttachments
    ? [`assert Path(${JSON.stringify(uploaded[0].path)}).read_text(encoding='utf8') == 'NATIVE_FILE_CONTENT'`]
    : []),
  `Path(${JSON.stringify(gateStarted)}).write_text('started', encoding='utf8')`,
  'deadline = time.monotonic() + 90',
  `while not Path(${JSON.stringify(gateRelease)}).exists():`,
  '    if time.monotonic() > deadline: raise TimeoutError("Smoke gate was not released")',
  '    time.sleep(0.05)',
  `Path(${JSON.stringify(gateFinished)}).write_text('finished', encoding='utf8')`,
  "print('BRIDGE_TOOL_FINISHED')",
].join('\n');
let providerError;
const provider = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(Buffer.byteLength(body) < 8 * 1024 * 1024, 'Requête fixture trop volumineuse');
    }
    const input = JSON.parse(body);
    assert.equal(input.model, 'queue-smoke');
    const userMessages = input.messages
      .filter((message) => message.role === 'user')
      .map((m) => splitFileMessage(imageMessageText(textOf(m.content))).text);
    const latest = userMessages.at(-1);
    const index = report.requests.length;
    report.requests.push({ index, latestUserMessage: latest });
    if (withAttachments) {
      const parts = input.messages.filter((message) => message.role === 'user').at(-1).content;
      assert.ok(
        Array.isArray(parts) &&
          parts.some((part) => part.type === 'image_url' && part.image_url?.url?.startsWith('data:image/')),
        'Le fournisseur reçoit les pixels de l’image',
      );
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const frame = (delta, finishReason = null) =>
      response.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-fixture-${index}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'queue-smoke',
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`,
      );
    frame({ role: 'assistant' });
    if (index === 0) {
      assert.ok(
        input.tools?.some((tool) => tool.function?.name === 'ipython'),
        'Le vrai outil Python doit être disponible',
      );
      frame({
        tool_calls: [
          {
            index: 0,
            id: 'call_fixture_gate',
            type: 'function',
            function: { name: 'ipython', arguments: JSON.stringify({ code: gateCode }) },
          },
        ],
      });
      frame({}, 'tool_calls');
    } else {
      frame({ content: `PROCESSED:${latest}` });
      frame({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  } catch (error) {
    providerError = error;
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: error.message } }));
  }
});
await new Promise((done, reject) => {
  provider.once('error', reject);
  provider.listen(0, '127.0.0.1', done);
});
await Promise.all([
  writeFile(join(agentDir, 'auth.json'), '{}\n'),
  writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify(
      {
        providers: {
          'studio-fixture': {
            api: 'openai-completions',
            baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
            apiKey: 'fixture-only-not-a-real-key',
            models: [
              {
                id: 'queue-smoke',
                name: 'Queue fixture',
                reasoning: false,
                input: ['text', 'image'],
                contextWindow: 131072,
                maxTokens: 4096,
              },
            ],
          },
        },
      },
      null,
      2,
    ),
  ),
  writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify(
      {
        defaultProvider: 'studio-fixture',
        defaultModel: 'queue-smoke',
        defaultThinkingLevel: 'off',
        steeringMode: 'one-at-a-time',
        followUpMode: 'one-at-a-time',
        autoRefine: { enabled: false },
        compaction: { enabled: false },
        retry: { enabled: false },
        telemetry: { enabled: false, noticeShown: true },
      },
      null,
      2,
    ),
  ),
]);
const runtime = createAgentRuntime({
  agentHome: agentDir,
  sessionDir,
  env: { ...process.env, PRIME_AGENT_TELEMETRY: '0' },
});
const store = createStore({ sessionDir, dataDir: join(directory, 'metadata') });
let handle;
let client;
let completed = false;
const events = [];
try {
  handle = await within(
    runtime.start({
      cwd,
      model: 'studio-fixture/queue-smoke',
      thinking: 'off',
      message: appendFileMessage(original, uploaded),
      ...(images.length ? { images } : {}),
      onEvent: (event) => events.push(event),
    }),
    60000,
    'démarrage du worker isolé',
  );
  void handle.done.then(() => {
    completed = true;
  });
  await until(
    async () => {
      if (providerError) throw providerError;
      if (completed)
        throw new Error(`Le worker a terminé avant le test de file : ${JSON.stringify(await handle.done)}`);
      return handle.sessionId && (await exists(gateStarted));
    },
    60000,
    'entrée dans le véritable outil Python',
  );
  const descriptor = await until(() => findDescriptor(handle.sessionId), 5000, 'descripteur privé du worker');
  assert.match(descriptor.supervisorSocketPath, /prime-studio-/);
  report.sessionId = handle.sessionId;
  client = createLiveSessionClient({
    packageDir: cli.packageDir,
    socketPath: descriptor.supervisorSocketPath,
    agentDir,
    supervisorPid: handle.daemonPid,
  });
  const initial = await client.getSnapshot(handle.sessionId, cwd);
  assert.equal(initial.state.isStreaming, true);
  assert.equal(
    (
      await client.send(handle.sessionId, cwd, {
        message: steeringOriginal,
        mode: 'steer',
        ...(images.length ? { images } : {}),
      })
    ).accepted,
    true,
  );
  for (const message of [followOriginal, followDeleted, followLast]) {
    assert.equal(
      (
        await client.send(handle.sessionId, cwd, {
          message,
          mode: 'follow_up',
          ...(images.length ? { images } : {}),
        })
      ).accepted,
      true,
    );
  }
  let snapshot = await client.getSnapshot(handle.sessionId, cwd);
  assert.deepEqual(
    { steering: snapshot.steering, followUp: snapshot.followUps },
    {
      steering: [steeringOriginal],
      followUp: [followOriginal, followDeleted, followLast],
    },
  );
  const mutate = async (lane, index, expectedText, mutation) => {
    const result = await client.mutate(handle.sessionId, cwd, { lane, index, expectedText, mutation });
    assert.equal(result.status, 'applied');
    return result;
  };
  await mutate('steering', 0, steeringOriginal, { type: 'replace', text: steeringEdited, lane: 'steering' });
  await mutate('followUp', 1, followDeleted, { type: 'delete' });
  await mutate('followUp', 0, followOriginal, { type: 'replace', text: followEdited, lane: 'followUp' });
  await mutate('followUp', 1, followLast, { type: 'move', direction: -1 });
  snapshot = await client.getSnapshot(handle.sessionId, cwd);
  assert.deepEqual(
    { steering: snapshot.steering, followUp: snapshot.followUps },
    { steering: [steeringEdited], followUp: [followLast, followEdited] },
  );
  assert.equal(
    completed,
    false,
    'La fermeture des connexions temporaires ne doit pas terminer le worker propriétaire',
  );
  assert.equal(
    await exists(gateFinished),
    false,
    'La réorientation ne doit pas interrompre l’outil en cours',
  );
  assert.equal(report.requests.length, 1, 'Aucun nouvel appel au modèle avant la fin de l’outil');
  const before = await store.history(handle.sessionId);
  assert.deepEqual(
    before.messages.filter((message) => message.role === 'user').map((m) => m.text),
    [original],
  );
  report.checks.push(
    'Acceptation avant livraison ; outil Python conservé ; connexions temporaires sans interruption',
  );
  report.checks.push('Files natives : réorientation, suite, modification, suppression et réorganisation');
  await writeFile(gateRelease, 'release\n');
  const result = await within(handle.done, 60000, 'livraison de toute la file par le client print');
  assert.equal(result.status, 'completed', result.error || result.status);
  if (providerError) throw providerError;
  const history = await store.history(handle.sessionId);
  const delivered = history.messages.filter((message) => message.role === 'user').map((m) => m.text);
  assert.deepEqual(delivered, [original, steeringEdited, followLast, followEdited]);
  if (withAttachments) {
    const users = history.messages.filter((message) => message.role === 'user');
    assert.deepEqual(
      users.map((message) => message.attachments.filter((item) => item.type === 'image').length),
      [1, 1, 1, 1],
    );
    assert.equal(users[0].attachments.find((item) => item.type === 'file')?.name, uploaded[0].name);
    report.checks.push(
      'Pixels reçus par le fournisseur, fichiers lus par Python, images et fichiers conservés dans l’historique après édition de la file.',
    );
  }
  assert.deepEqual(
    report.requests.map((request) => request.latestUserMessage),
    delivered,
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === 'tool_end' &&
        !event.isError &&
        JSON.stringify(event.result).includes('BRIDGE_TOOL_FINISHED'),
    ),
  );
  assert.ok(history.messages.some((m) => m.role === 'assistant' && m.text === `PROCESSED:${followEdited}`));
  report.checks.push(
    'Livraison dans l’ordre après la fin de l’outil ; client print attend la dernière suite',
  );
  report.delivered = delivered;
  report.passed = true;
} catch (error) {
  report.error = String(error.stack || error).slice(0, 5000);
  process.exitCode = 1;
} finally {
  await writeFile(gateRelease, 'cleanup\n').catch(() => {});
  await client?.close?.();
  await runtime.close();
  provider.closeAllConnections();
  await new Promise((done) => provider.close(done));
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({ passed: report.passed, checks: report.checks, error: report.error, report: reportPath }),
  );
}
