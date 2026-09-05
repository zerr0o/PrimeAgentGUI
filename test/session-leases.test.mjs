import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverCli } from '../lib/agent.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = discoverCli()?.packageDir;
const installedLease = packageDir && join(packageDir, 'dist', 'core', 'session-lease.js');
const supported = process.platform === 'win32' && installedLease && existsSync(installedLease);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'prime-studio-leases-'));
  const session = join(directory, 'sessions', 'fixture.jsonl');
  await mkdir(dirname(session));
  await writeFile(session, '{"type":"session","id":"fixture"}\n');
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('prime-studio-leases-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const source = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    const { acquireSessionLease, SessionAlreadyActiveError } = await import(process.env.STUDIO_LEASE_MODULE);
    const directory = process.env.STUDIO_LEASE_FIXTURE;
    const session = path.join(directory, 'sessions', 'fixture.jsonl');
    const environment = { PRIME_AGENT_INTERNAL_SESSION_LEASES: '1', PRIME_AGENT_INTERNAL_SESSION_LEASE_OWNER_ID: 'fixture-owner' };
  `;
  async function run(code, { patched = true } = {}) {
    return execFileAsync(
      process.execPath,
      [
        ...(patched ? ['--require', join(root, 'runtime', 'windows-hidden.cjs')] : []),
        '--input-type=module',
        '-e',
        source + code,
      ],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          PRIME_GUI_SILENT: '1',
          STUDIO_LEASE_FIXTURE: directory,
          STUDIO_LEASE_MODULE: pathToFileURL(installedLease).href,
        },
        windowsHide: true,
        timeout: 20000,
      },
    );
  }
  return { directory, session, run };
}

test('Windows native lease rejects a live owner and preserves its lease', { skip: !supported }, async (t) => {
  const { run } = await fixture(t);
  await run(`
    const first = acquireSessionLease(session, directory, environment);
    const before = fs.readFileSync(path.join(first.directory, 'owner.json'), 'utf8');
    assert.throws(() => acquireSessionLease(session, directory, environment), error => {
      assert.ok(error instanceof SessionAlreadyActiveError);
      assert.equal(error.activeSessionId, 'fixture-owner');
      return true;
    });
    assert.equal(fs.readFileSync(path.join(first.directory, 'owner.json'), 'utf8'), before);
    first.release();
    assert.equal(fs.existsSync(first.directory), false);
  `);
});

test('Windows native lease reclaims a confirmed exited owner', { skip: !supported }, async (t) => {
  const { directory, run } = await fixture(t);
  const previous = await run(`
    const lease = acquireSessionLease(session, directory, environment);
    console.log(JSON.stringify({ pid: process.pid, lock: lease.directory }));
    // Simulate abrupt worker exit: native SessionLease deliberately has no exit cleanup.
  `);
  const old = JSON.parse(previous.stdout.trim());
  assert.throws(() => process.kill(old.pid, 0), { code: 'ESRCH' });
  const original = JSON.parse(await readFile(join(old.lock, 'owner.json'), 'utf8'));
  assert.equal(original.pid, old.pid);
  await run(`
    const lease = acquireSessionLease(session, directory, environment);
    assert.equal(JSON.parse(fs.readFileSync(path.join(lease.directory, 'owner.json'), 'utf8')).pid, process.pid);
    lease.release();
    assert.deepEqual(fs.readdirSync(path.join(directory, 'session-leases')), []);
  `);
  assert.ok(existsSync(join(directory, 'sessions', 'fixture.jsonl')));
});

test(
  'Windows native lease uses process start identity and preserves unknown live owners',
  { skip: !supported },
  async (t) => {
    const { run } = await fixture(t);
    await run(`
    const first = acquireSessionLease(session, directory, environment);
    const ownerPath = path.join(first.directory, 'owner.json');
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    delete owner.processStartId;
    fs.writeFileSync(ownerPath, JSON.stringify(owner));
    assert.throws(() => acquireSessionLease(session, directory, environment), SessionAlreadyActiveError);
    owner.processStartId = 'win:0';
    fs.writeFileSync(ownerPath, JSON.stringify(owner));
    const replacement = acquireSessionLease(session, directory, environment);
    assert.notEqual(replacement.token, first.token);
    first.release();
    assert.equal(fs.existsSync(replacement.directory), true);
    replacement.release();
  `);
  },
);

test(
  'Windows compatibility leaves unrelated directory collisions unchanged',
  { skip: !supported },
  async (t) => {
    const { run } = await fixture(t);
    await run(`
    const target = path.join(directory, 'unrelated');
    const candidate = target + '.candidate-' + process.pid + '-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    fs.mkdirSync(target);
    fs.mkdirSync(candidate);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
    assert.throws(() => fs.renameSync(candidate, target), { code: 'EPERM' });
    assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
  `);
  },
);
