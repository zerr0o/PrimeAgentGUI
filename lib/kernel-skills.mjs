import { formatMessage as tr } from '../public/i18n-core.js';
import { fork } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

export function discoverPythonSkills({ packageDir, cwd, agentHome, env, signal }) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(new Error(tr('server.preparation_du_noyau_annulee')));
    const child = fork(fileURLToPath(new URL('../scripts/kernel-catalog-worker.mjs', import.meta.url)), [], {
      cwd,
      env,
      execArgv: [],
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let settled = false,
      stderr = '';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child.kill();
      error ? reject(error) : resolvePromise(value);
    };
    const abort = () => finish(new Error(tr('server.preparation_du_noyau_annulee')));
    const timer = setTimeout(
      () => finish(new Error(tr('server.la_decouverte_des_skills_python_a_depasse_30_s'))),
      30000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (error) => finish(error));
    child.on('exit', () =>
      finish(new Error(tr('server.la_decouverte_native_des_skills_a_echoue', { value1: stderr }))),
    );
    child.on('message', (data) =>
      data?.ok
        ? finish(null, data)
        : finish(new Error(tr('server.skills_python', { value1: data?.error || 'catalogue incompatible' }))),
    );
    child.send({ packageDir, cwd, agentHome });
  });
}

const normalizedName = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

// All local requirements participate in one uv resolution, including sibling
// helper packages without SKILL.md. Never resolve their names from a registry.
export async function resolveSkillPackages(skills) {
  const packages = new Map(),
    manifests = new Map();
  async function manifest(path) {
    if (!manifests.has(path)) {
      try {
        manifests.set(path, parse(await readFile(join(path, 'pyproject.toml'), 'utf8')).project);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error(`pyproject.toml invalide dans ${path} : ${error.message}`);
      }
    }
    const project = manifests.get(path);
    if (typeof project?.name !== 'string' || !project.name)
      throw new Error(tr('server.nom_du_package_python_absent_dans_pyproject_toml', { value1: path }));
    return project;
  }
  async function add(path, skill) {
    path = resolve(path);
    const project = await manifest(path);
    if (!project) throw new Error(tr('server.package_python_introuvable', { value1: path }));
    const name = normalizedName(project.name);
    const previous = packages.get(name);
    if (previous && previous.packagePath !== path)
      throw new Error(
        tr('server.deux_packages_python_locaux_portent_le_meme_nom_et', {
          value1: project.name,
          value2: previous.packagePath,
          value3: path,
        }),
      );
    if (previous) return;
    const entry = {
      ...skill,
      name: project.name,
      packagePath: path,
      pyprojectPath: join(path, 'pyproject.toml'),
      project,
    };
    packages.set(name, entry);
  }
  for (const skill of skills) await add(skill.packagePath, skill);
  const checked = new Set();
  while (true) {
    const item = [...packages.values()].find((entry) => !checked.has(entry.packagePath));
    if (!item) break;
    checked.add(item.packagePath);
    const siblings = await readdir(dirname(item.packagePath), { withFileTypes: true });
    if (item.project.dependencies !== undefined && !Array.isArray(item.project.dependencies))
      throw new Error(
        tr('server.la_liste_des_dependances_python_est_invalide_dans', { value1: item.pyprojectPath }),
      );
    for (const dependency of item.project.dependencies || []) {
      const match = typeof dependency === 'string' && dependency.match(/^\s*([A-Za-z0-9_.-]+)/);
      if (!match)
        throw new Error(tr('server.dependance_python_invalide_dans', { value1: item.pyprojectPath }));
      const name = normalizedName(match[1]);
      if (packages.has(name) || name === 'prime-agent-runtime') continue;
      const matches = [];
      for (const sibling of siblings) {
        if (!sibling.isDirectory() || sibling.name.startsWith('.')) continue;
        const path = join(dirname(item.packagePath), sibling.name);
        let project;
        try {
          project = await manifest(path);
        } catch (error) {
          // A disabled/unrelated broken skill must not prevent another skill
          // from starting. A matching local dependency must never fall back to PyPI.
          if (normalizedName(sibling.name) === name) throw error;
          continue;
        }
        if (project && normalizedName(project.name) === name) matches.push(path);
      }
      if (matches.length > 1)
        throw new Error(
          tr('server.dependance_locale_ambigue_pour', { value1: name, value2: item.packagePath }),
        );
      if (matches.length) await add(matches[0]);
    }
  }
  return [...packages.values()]
    .map(({ project, ...entry }) => entry)
    .sort((a, b) => a.packagePath.localeCompare(b.packagePath));
}
