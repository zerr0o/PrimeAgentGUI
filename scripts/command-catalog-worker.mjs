// Read native resource metadata without installing packages, executing extensions,
// opening providers, starting a kernel or touching a running agent session.
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, statSync } from 'node:fs';
process.once('message', async ({ cwd, agentHome, packageDir }) => {
  try {
    const native = (name) => import(pathToFileURL(join(packageDir, `dist/core/${name}.js`)).href);
    const [
      { SettingsManager },
      { AuthStorage },
      { McpManager },
      { DefaultPackageManager },
      skills,
      prompts,
      slash,
    ] = await Promise.all([
      native('settings-manager'),
      native('auth-storage'),
      native('mcp/mcp-manager'),
      native('package-manager'),
      native('skills'),
      native('prompt-templates'),
      native('slash-commands'),
    ]);
    const settingsManager = SettingsManager.create(cwd, agentHome);
    const mcp = new McpManager({
      authStorage: AuthStorage.create(join(agentHome, 'auth.json')),
      getUserServers: () => settingsManager.getGlobalMcpServers(),
    });
    const manager = new DefaultPackageManager({
      cwd,
      agentDir: agentHome,
      settingsManager,
      extraBuiltinSkillOverrides: () => mcp.getDisabledBuiltinSkillOverrides(),
    });
    const missing = [];
    const paths = await manager.resolve(async (source) => {
      missing.push({ message: `Package absent : ${source}. Installez-le depuis Prime Agent.` });
      return 'skip';
    });
    const enabled = (kind) => paths[kind].filter((entry) => entry.enabled);
    const skillPaths = enabled('skills').map((entry) => {
      if (
        (entry.metadata.source === 'auto' || entry.metadata.origin === 'package') &&
        existsSync(entry.path) &&
        statSync(entry.path).isDirectory() &&
        existsSync(join(entry.path, 'SKILL.md'))
      )
        return join(entry.path, 'SKILL.md');
      return entry.path;
    });
    const loadedSkills = skills.loadSkills({ cwd, agentDir: agentHome, includeDefaults: false, skillPaths });
    const loadedPrompts = prompts.loadPromptTemplates({
      cwd,
      agentDir: agentHome,
      includeDefaults: false,
      promptPaths: enabled('prompts').map((entry) => entry.path),
    });
    const source = (item, kind) => {
      const entry = enabled(kind).find(
        (e) =>
          item.filePath === e.path ||
          item.filePath.startsWith(e.path + '/') ||
          item.filePath.startsWith(e.path + '\\'),
      );
      return { scope: entry?.metadata.scope || item.source || 'project', path: item.filePath };
    };
    const uniquePrompts = [
      ...new Map([...loadedPrompts].reverse().map((p) => [p.name, p])).values(),
    ].reverse();
    const commands = [
      ...loadedSkills.skills.map((s) => ({
        name: `skill:${s.name}`,
        description: s.description,
        source: 'skill',
        sourceInfo: source(s, 'skills'),
        explicitOnly: s.disableModelInvocation === true,
        pythonPackage: existsSync(join(dirname(s.filePath), 'pyproject.toml')),
        argumentHint: '[consignes]',
      })),
      ...uniquePrompts.map((p) => ({
        name: p.name,
        description: p.description,
        source: 'prompt',
        sourceInfo: source(p, 'prompts'),
        argumentHint: p.argumentHint || '[arguments]',
      })),
    ];
    process.send({
      ok: true,
      catalog: {
        commands,
        builtins: slash.BUILTIN_SLASH_COMMANDS.map(({ name, description, argumentHint }) => ({
          name,
          description,
          argumentHint,
        })),
        diagnostics: [...missing, ...loadedSkills.diagnostics, ...(paths.diagnostics || [])].map(
          ({ message }) => ({ message }),
        ),
      },
    });
  } catch {
    process.send({ ok: false });
  }
});
