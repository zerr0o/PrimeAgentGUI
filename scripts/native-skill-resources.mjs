import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, statSync } from 'node:fs';

// Use the installed resource manager's precedence, package filters and MCP
// overrides without executing extensions or installing missing packages.
export async function nativeSkillResources({ cwd, agentHome, packageDir }) {
  const native = (name) => import(pathToFileURL(join(packageDir, `dist/core/${name}.js`)).href);
  const [{ SettingsManager }, { AuthStorage }, { McpManager }, { DefaultPackageManager }, skills] =
    await Promise.all(
      ['settings-manager', 'auth-storage', 'mcp/mcp-manager', 'package-manager', 'skills'].map(native),
    );
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
  return { native, enabled, loadedSkills, paths, missing, skills };
}
