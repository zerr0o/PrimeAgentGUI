// Read native resource metadata without installing packages, executing extensions,
// opening providers, starting a kernel or touching a running agent session.
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { nativeSkillResources } from './native-skill-resources.mjs';
process.once('message', async ({ cwd, agentHome, packageDir }) => {
  try {
    const { native, enabled, loadedSkills, paths, missing } = await nativeSkillResources({
      cwd,
      agentHome,
      packageDir,
    });
    const [prompts, slash] = await Promise.all([native('prompt-templates'), native('slash-commands')]);
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
