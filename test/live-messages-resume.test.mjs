import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createLiveMessages } from '../lib/live-messages.mjs';

const cwd = resolve('test/resumed-live-project');
const sessionId = 'resumed-native-session';
const completed = { id: 'previous-completed-run', sessionId, cwd, status: 'completed' };
const running = { id: 'current-running-run', sessionId, cwd, status: 'running' };
function fixture(runs = [completed, running]) {
  const selected = [];
  const calls = [];
  const snapshot = { available: true, steering: ['message en attente'], followUps: [] };
  const native = {
    async getSnapshot(id, path) {
      calls.push(['snapshot', id, path]);
      return snapshot;
    },
    async send(id, path, input) {
      calls.push(['send', id, path, input]);
      return { accepted: true, snapshot };
    },
    async mutate(id, path, input) {
      calls.push(['mutate', id, path, input]);
      return { status: 'applied', snapshot };
    },
  };
  const service = createLiveMessages({
    getRuns: () => runs,
    getClient: (run) => {
      selected.push(run.id);
      return native;
    },
  });
  return { service, selected, calls, snapshot };
}

test('retained completed runs do not hide live queue availability after resuming the same session', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.getSnapshot(sessionId, cwd), f.snapshot);
  assert.deepEqual(f.selected, [running.id]);
});

test('steering and queue mutations target the resumed running execution rather than older completed runs', async () => {
  const f = fixture();
  const result = await f.service.send(sessionId, {
    cwd,
    message: 'Nouvelle consigne',
    mode: 'steer',
    requestId: 'resume-request-000001',
  });
  assert.equal(result.accepted, true);
  const mutation = await f.service.mutate(sessionId, {
    cwd,
    lane: 'steering',
    index: 0,
    expectedText: 'message en attente',
    mutation: { type: 'delete' },
  });
  assert.equal(mutation.status, 'applied');
  assert.deepEqual(f.selected, [running.id, running.id]);
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ['send', 'mutate'],
  );
});

test('an older completed run and an active run from a different project cannot admit live input', async () => {
  const f = fixture([completed, { ...running, cwd: resolve('test/different-project') }]);
  assert.equal((await f.service.getSnapshot(sessionId, cwd)).available, false);
  await assert.rejects(
    f.service.send(sessionId, {
      cwd,
      message: 'Ne pas transmettre',
      mode: 'steer',
      requestId: 'resume-request-000002',
    }),
    { status: 409 },
  );
  assert.deepEqual(f.calls, []);
});

test('a stopping resumed run remains observable while refusing new messages', async () => {
  const f = fixture([completed, { ...running, status: 'stopping' }]);
  assert.equal((await f.service.getSnapshot(sessionId, cwd)).available, true);
  await assert.rejects(
    f.service.send(sessionId, {
      cwd,
      message: 'Ne pas transmettre',
      mode: 'follow_up',
      requestId: 'resume-request-000003',
    }),
    { status: 409 },
  );
  assert.deepEqual(
    f.calls.map(([kind]) => kind),
    ['snapshot'],
  );
});
