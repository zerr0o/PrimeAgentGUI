import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const preload = fileURLToPath(new URL('../runtime/cli-control.cjs', import.meta.url));
function fixture(source) {
  const child = spawn(process.execPath, ['--require', preload, '-e', source], {
    env: { ...process.env, PRIME_GUI_CONTROL: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '',
    error = '';
  child.stdout.on('data', (value) => {
    output += value;
  });
  child.stderr.on('data', (value) => {
    error += value;
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output, error }));
  });
  return { child, done };
}

test(
  'GUI cancellation waits for native handlers and runs asynchronous session cleanup once',
  { timeout: 5000 },
  async () => {
    const { child, done } = fixture(`
    const assert = require('node:assert/strict');
    assert.equal(process.env.PRIME_GUI_CONTROL, undefined);
    const keepAlive = setInterval(() => {}, 1000);
    let calls = 0;
    setTimeout(() => process.on('SIGTERM', () => {
      calls++;
      setTimeout(() => {
        assert.equal(calls, 1);
        process.stdout.write('NATIVE_SESSION_CLEANED');
        clearInterval(keepAlive);
      }, 80);
    }), 100);
  `);
    child.send({ type: 'untrusted-tool-text', version: 1 });
    child.send({ type: 'prime-studio:cancel', version: 0 });
    child.send({ type: 'prime-studio:cancel', version: 1 });
    child.send({ type: 'prime-studio:cancel', version: 1 });
    const result = await done;
    assert.equal(result.code, 0, result.error);
    assert.equal(result.output, 'NATIVE_SESSION_CLEANED');
  },
);

test('GUI control channel does not keep a normally completed CLI alive', { timeout: 5000 }, async () => {
  const { done } = fixture(`process.stdout.write('COMPLETED');`);
  const result = await done;
  assert.equal(result.code, 0, result.error);
  assert.equal(result.output, 'COMPLETED');
});
