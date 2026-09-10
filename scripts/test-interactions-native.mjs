import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { interactiveStudio } from './fixtures/interactive-studio.mjs';

const fixture = await interactiveStudio();
const events = [];
async function waitFor(test, milliseconds = 30000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    const result = test();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Native interaction timed out: ' + JSON.stringify(events.slice(-5)));
}
try {
  for (const answer of ['option', 'Une page centrée sur les résultats', null]) {
    events.length = 0;
    const images =
      answer === 'option'
        ? [
            {
              type: 'image',
              mimeType: 'image/png',
              data: (await readFile(join(fixture.cwd, 'captures/apercu.png'))).toString('base64'),
            },
          ]
        : [];
    const handle = await fixture.runtime.start({
      cwd: fixture.cwd,
      model: 'fixture/demo',
      message: 'Préparer un aperçu et poser une question.',
      images,
      allowQuestions: true,
      onEvent: (event) => events.push(event),
    });
    const request = await waitFor(
      () =>
        events.find((event) => event.kind === 'interaction' && event.request.status === 'pending')?.request,
    );
    assert.equal(request.allowCustom, true);
    const response =
      answer === null ? { cancelled: true } : { value: answer === 'option' ? request.options[0] : answer };
    await handle.respond(request.id, response);
    await assert.rejects(() => handle.respond(request.id, response), /plus de réponse/);
    const result = await handle.done;
    assert.equal(result.status, 'completed', result.error);
    const history = await fixture.app.store.history(handle.sessionId);
    if (images.length)
      assert.ok(
        history.messages.some((message) => message.attachments?.some((item) => item.type === 'image')),
      );
    const tool = history.messages
      .flatMap((message) => message.tools || [])
      .find((tool) => tool.name === 'question');
    const native = JSON.parse(tool.result);
    assert.equal(native.answer, answer === 'option' ? 'Vue compacte' : answer);
    assert.equal(native.wasCustom, answer !== 'option' && answer !== null);
    // Resuming without the option must not keep the extension from a previous run.
    const resumed = await fixture.runtime.start({
      cwd: fixture.cwd,
      sessionId: handle.sessionId,
      sessionFile: history.file,
      model: 'fixture/demo',
      message: 'Sans question',
      allowQuestions: false,
    });
    assert.equal((await resumed.done).status, 'completed');
    assert.ok(!fixture.requests.at(-1).tools.some((tool) => tool.function.name === 'question'));
  }
  events.length = 0;
  const pending = await fixture.runtime.start({
    cwd: fixture.cwd,
    model: 'fixture/demo',
    message: 'Interrompre une question',
    allowQuestions: true,
    onEvent: (event) => events.push(event),
  });
  await waitFor(() => events.some((event) => event.kind === 'interaction'));
  assert.equal((await pending.cancel()).status, 'stopped');
  assert.ok(events.some((event) => event.kind === 'interaction' && event.request.status !== 'pending'));
  await mkdir('.local/interactive-review', { recursive: true });
  await writeFile(
    '.local/interactive-review/native-proof.json',
    JSON.stringify(
      {
        passed: true,
        root: fixture.root,
        checks: [
          'Native question discovery',
          'Option result persisted in native JSONL',
          'Free text result persisted',
          'Cancellation without invented answer',
          'Duplicate reply refused',
          'Option removed on resume',
          'Stop cancels pending question',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Native interactive integration PASS', fixture.root);
} catch (error) {
  await writeFile(
    join(fixture.root, 'failure.json'),
    JSON.stringify({ events, requests: fixture.requests }, null, 2),
  );
  throw error;
} finally {
  await fixture.close();
}
