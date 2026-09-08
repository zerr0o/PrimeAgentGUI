import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { discoverCli } from '../lib/agent.mjs';
import { transformCodexTransport } from '../runtime/transport-hook.mjs';

test('real installed Codex transports rotate aged idle sockets, preserve busy ones and reset cache', async (t) => {
  const cli = discoverCli();
  if (!cli?.packageDir) return t.skip('Prime Agent integration requires the installed runtime');
  const bundle = (await readdir(join(cli.packageDir, 'dist/bundle'))).find((name) =>
    /^openai-codex-responses-.*\.js$/.test(name),
  );
  for (const path of [
    join(cli.packageDir, 'dist/bundle', bundle),
    join(cli.packageDir, 'node_modules/@earendil-works/pi-ai/dist/providers/openai-codex-responses.js'),
  ]) {
    const transformed = transformCodexTransport(await readFile(path, 'utf8'));
    const body = transformed.slice(
      transformed.indexOf('async function acquireWebSocket('),
      transformed.indexOf('function extractWebSocketError('),
    );
    let now = 0,
      serial = 0;
    const cache = new Map();
    const context = vm.createContext({
      Date: { now: () => now },
      websocketSessionCache: cache,
      connectWebSocket: async () => ({ id: ++serial, closed: false }),
      closeWebSocketSilently: (socket) => (socket.closed = true),
      isWebSocketReusable: (socket) => !socket.closed,
      clearTimeout: () => {},
      scheduleSessionWebSocketExpiry: () => {},
    });
    vm.runInContext(transformed.slice(0, transformed.indexOf('\n')) + '\n' + body, context);
    const acquire = () => context.acquireWebSocket('wss://fixture', {}, 'session');
    const first = await acquire();
    first.entry.lastResponseId = 'old-connection-context';
    first.release({ keep: true });
    now = 49 * 60 * 1000;
    const reused = await acquire();
    assert.equal(reused.reused, true);
    reused.release({ keep: true });
    now = 51 * 60 * 1000;
    const rotated = await acquire();
    assert.equal(rotated.reused, false);
    assert.equal(first.socket.closed, true);
    assert.equal(rotated.entry.lastResponseId, undefined, 'New connection must send full context');
    now = 120 * 60 * 1000;
    const concurrent = await acquire();
    assert.notEqual(concurrent.socket, rotated.socket);
    assert.equal(rotated.socket.closed, false, 'Never interrupt an active request');
    concurrent.release();
    rotated.release({ keep: true });
    assert.equal(cache.size, 0);
    assert.equal(rotated.socket.closed, true);
  }
});

test('unknown upstream transport layouts fail explicitly', () => {
  assert.throws(() => transformCodexTransport('// incompatible implementation'), /requires an update/);
});
