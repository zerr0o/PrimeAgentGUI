import { fork } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

export function discoverPythonSkills({ packageDir, cwd, agentHome, env, signal }) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(new Error('Préparation du noyau annulée.'));
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
    const abort = () => finish(new Error('Préparation du noyau annulée.'));
    const timer = setTimeout(
      () => finish(new Error('La découverte des skills Python a dépassé 30 s.')),
      30000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (error) => finish(error));
    child.on('exit', () => finish(new Error(`La découverte native des skills a échoué. ${stderr}`)));
    child.on('message', (data) =>
      data?.ok
        ? finish(null, data)
        : finish(new Error(`Skills Python : ${data?.error || 'catalogue incompatible'}`)),
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
      throw new Error(`Nom du package Python absent dans ${path}/pyproject.toml.`);
    return project;
  }
  async function add(path, skill) {
    path = resolve(path);
    const project = await manifest(path);
    if (!project) throw new Error(`Package Python introuvable : ${path}`);
    const name = normalizedName(project.name);
    const previous = packages.get(name);
    if (previous && previous.packagePath !== path)
      throw new Error(
        `Deux packages Python locaux portent le même nom « ${project.name} » : ${previous.packagePath} et ${path}.`,
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
      throw new Error(`La liste des dépendances Python est invalide dans ${item.pyprojectPath}.`);
    for (const dependency of item.project.dependencies || []) {
      const match = typeof dependency === 'string' && dependency.match(/^\s*([A-Za-z0-9_.-]+)/);
      if (!match) throw new Error(`Dépendance Python invalide dans ${item.pyprojectPath}.`);
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
        throw new Error(`Dépendance locale ambiguë « ${name} » pour ${item.packagePath}.`);
      if (matches.length) await add(matches[0]);
    }
  }
  return [...packages.values()]
    .map(({ project, ...entry }) => entry)
    .sort((a, b) => a.packagePath.localeCompare(b.packagePath));
}
