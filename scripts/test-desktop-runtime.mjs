// Exercise the shipped modules and real Prime Agent workers in an isolated project, with no model call.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyDesktopRuntimeResources } from './desktop-runtime-resources.mjs';
const studio = resolve(process.argv[2] || '.desktop-build/studio');
await verifyDesktopRuntimeResources(studio);
const load = (path) => import(pathToFileURL(join(studio, path)).href);
const [
  { discoverCli, agentEnvironment },
  { createCommandService },
  { discoverPythonSkills },
  { createProviderService },
] = await Promise.all([
  load('lib/agent.mjs'),
  load('lib/commands.mjs'),
  load('lib/kernel-skills.mjs'),
  load('lib/provider-service.mjs'),
]);
const cli = discoverCli();
assert.ok(cli?.packageDir, 'Install Prime Agent to run the packaged runtime integration test');
const root = await mkdtemp(join(tmpdir(), 'studio-packaged-runtime-')),
  cwd = join(root, 'project'),
  agentHome = join(root, 'agent');
const skillsDir = join(cwd, '.prime/agent/skills/packaged-check'),
  promptsDir = join(cwd, '.prime/agent/prompts');
await Promise.all([skillsDir, promptsDir, agentHome].map((path) => mkdir(path, { recursive: true })));
await writeFile(
  join(skillsDir, 'SKILL.md'),
  '---\nname: packaged-check\ndescription: Packaging regression fixture\n---\nRead-only package fixture.',
);
await writeFile(join(skillsDir, 'pyproject.toml'), '[project]\nname = "packaged-check"\nversion = "0.1.0"\n');
await mkdir(join(skillsDir, 'src/packaged_check'), { recursive: true });
await writeFile(join(skillsDir, 'src/packaged_check/__init__.py'), '# Read-only discovery fixture\n');
await writeFile(
  join(promptsDir, 'packaged-prompt.md'),
  '---\ndescription: Packaged prompt fixture\n---\nFixture $1',
);
await writeFile(join(agentHome, 'auth.json'), '{}');
await writeFile(
  join(agentHome, 'settings.json'),
  JSON.stringify({ telemetry: { enabled: false, noticeShown: true } }),
);
const catalog = createCommandService({ agentHome });
const providers = createProviderService({ agentHome });
let serverApp;
try {
  const { version } = JSON.parse(await readFile(join(studio, 'package.json'), 'utf8'));
  const { createApp } = await load('server.mjs');
  serverApp = createApp({
    agentHome,
    sessionDir: join(root, 'sessions'),
    dataDir: join(root, 'data'),
    initialCwd: cwd,
    runtime: {
      getStatus: async () => ({ available: true, version: 'fixture' }),
      getModels: async () => ({ models: [] }),
      close: async () => {},
    },
  });
  await new Promise((done) => serverApp.server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${serverApp.server.address().port}`;
  const health = await (await fetch(url + '/api/health')).json();
  const system = await (await fetch(url + '/api/system')).json();
  assert.equal(health.version, version, 'Health must report the packaged server version');
  assert.equal(system.studio, version, 'System settings must report the packaged server version');
  const commands = await catalog.list({ cwd });
  assert.ok(commands.commands.some((command) => command.name === 'skill:packaged-check'));
  assert.ok(commands.commands.some((command) => command.name === 'packaged-prompt'));
  const python = await discoverPythonSkills({
    packageDir: cli.packageDir,
    cwd,
    agentHome,
    env: agentEnvironment({ agentHome }),
  });
  assert.ok(
    python.skills.some((skill) => skill.name === 'packaged-check'),
    'Python skills must be discovered by the shipped worker',
  );
  const list = await providers.list();
  assert.ok(list.providers.length > 0, 'Provider worker must return the native catalog');
  console.log(
    `Packaged runtime passed: server version ${version}, ${commands.commands.length} commands, Python skill, ${list.providers.length} providers, Windows/MCP helper closure.`,
  );
} finally {
  await serverApp?.close();
  catalog.close();
  providers.close();
  assert.equal(dirname(root), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
