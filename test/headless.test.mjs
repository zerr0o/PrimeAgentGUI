import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformPrintMode, initialize, load } from '../runtime/headless-hook.mjs';
import { discoverCli } from '../lib/agent.mjs';

const exec = promisify(execFile);
const wrapper = fileURLToPath(new URL('../runtime/headless-loader.mjs', import.meta.url));
const originalCall = 'await connection.waitForHeadlessCompletion()';
const changedCall = 'await connection.waitForHeadlessCompletion({ waitForRlmQuiescence: true })';
const printSource = `async function runPrintModeWithConnectionInternal(connection, options, bindHeadlessExtensions) {
  const autonomousStatus = await connection.waitForHeadlessCompletion();
  return autonomousStatus;
}
export { runPrintModeWithConnectionInternal as run };
`;

test('the compatibility transform enables the child barrier only in the native print function', () => {
  const source = `async function other(connection) { return ${originalCall}; }\n${printSource}\nasync function rpc(connection) { return ${originalCall}; }`;
  const result = transformPrintMode(source);
  assert.equal(result.changed, true);
  assert.equal(result.source.replace(changedCall, originalCall), source);
  assert.equal(result.source.split(originalCall).length - 1, 2);
  assert.equal(result.source.split(changedCall).length - 1, 1);
  assert.deepEqual(transformPrintMode('export const unrelated = 1;'), {
    source: 'export const unrelated = 1;',
    changed: false,
  });
});

test('changed native layouts fail explicitly instead of silently skipping child completion', () => {
  assert.throws(
    () => transformPrintMode('export const missing = 1;', { required: true }),
    /version de Prime Agent a changé/,
  );
  assert.throws(
    () => transformPrintMode('// dist/modes/print-mode.js\nexport const renamed = 1;'),
    /version de Prime Agent a changé/,
  );
  assert.throws(
    () =>
      transformPrintMode(
        printSource.replace(originalCall, 'await connection.waitForHeadlessCompletion(options)'),
      ),
    /version de Prime Agent a changé/,
  );
  assert.throws(
    () => transformPrintMode(printSource.replace(originalCall, `${originalCall}; ${originalCall}`)),
    /version de Prime Agent a changé/,
  );
  assert.throws(() => transformPrintMode(printSource + printSource), /version de Prime Agent a changé/);
});

test('the loader scopes the patch to this installation and leaves RPC and outside modules intact', async () => {
  const root = resolve('test/fake-prime-headless-package');
  initialize({ packageRoot: root });
  const readModule = async () => ({ format: 'module', source: Buffer.from(printSource) });
  for (const relativePath of ['dist/modes/print-mode.js', 'dist/bundle/chunk-TEST.js']) {
    const result = await load(pathToFileURL(join(root, relativePath)).href, {}, readModule);
    assert.ok(result.source.includes(changedCall));
  }
  for (const path of [
    join(root, 'dist/modes/rpc/rpc-mode.js'),
    join(`${root}-other`, 'dist/modes/print-mode.js'),
  ]) {
    const result = await load(pathToFileURL(path).href, {}, readModule);
    assert.equal(result.source.toString(), printSource);
  }
});

test('Node --import runs the scoped hook and consumes its inherited role marker', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prime-gui-headless-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const printPath = join(root, 'dist/modes/print-mode.js');
  const outsidePath = join(root, 'outside.js');
  await mkdir(join(root, 'dist/modes'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(printPath, printSource);
  await writeFile(outsidePath, printSource);
  const { stdout, stderr } = await exec(
    process.execPath,
    [
      '--import',
      pathToFileURL(wrapper).href,
      '--input-type=module',
      '-e',
      `import {run} from ${JSON.stringify(pathToFileURL(printPath).href)};
     import {run as outside} from ${JSON.stringify(pathToFileURL(outsidePath).href)};
     const connection = {waitForHeadlessCompletion(options) {return options || {unchanged:true}}};
     console.log(JSON.stringify({print:await run(connection), outside:await outside(connection), marker:process.env.PRIME_GUI_CLI_ROOT ?? null}));`,
    ],
    { env: { ...process.env, PRIME_GUI_CLI_ROOT: root }, windowsHide: true, timeout: 10000 },
  );
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), {
    print: { waitForRlmQuiescence: true },
    outside: { unchanged: true },
    marker: null,
  });
  assert.equal(await readFile(printPath, 'utf8'), printSource, 'The installed file remains untouched');
});

const cli = discoverCli();
test(
  'the installed Prime Agent bundle and unbundled print each contain exactly one supported target',
  { skip: !cli?.packageDir },
  async () => {
    const bundleDir = join(cli.packageDir, 'dist/bundle');
    let changedBundles = 0;
    for (const filename of (await readdir(bundleDir)).filter((filename) => filename.endsWith('.js'))) {
      const source = await readFile(join(bundleDir, filename), 'utf8');
      const result = transformPrintMode(source);
      if (result.changed) {
        changedBundles++;
        const functionStart = source.indexOf('async function runPrintModeWithConnectionInternal(');
        const callStart = source.indexOf(originalCall, functionStart);
        assert.equal(
          result.source,
          source.slice(0, callStart) + changedCall + source.slice(callStart + originalCall.length),
        );
      }
    }
    assert.equal(changedBundles, 1);
    const unbundled = await readFile(join(cli.packageDir, 'dist/modes/print-mode.js'), 'utf8');
    assert.equal(
      transformPrintMode(unbundled, { required: true }).source.replace(changedCall, originalCall),
      unbundled,
    );
  },
);

test(
  'the real installed CLI starts with the loader without invoking a model',
  { skip: !cli?.node || !cli?.packageDir, timeout: 30000 },
  async () => {
    const { stdout, stderr } = await exec(
      process.execPath,
      ['--import', pathToFileURL(wrapper).href, cli.path, '--version'],
      {
        env: { ...process.env, PRIME_GUI_CLI_ROOT: cli.packageDir },
        windowsHide: true,
        timeout: 20000,
      },
    );
    assert.match(stdout + stderr, /\d+\.\d+\.\d+/);
  },
);
