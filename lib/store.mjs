import { readFile, readdir, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { imageAttachments, imageMessageText } from './images.mjs';
import { splitFileMessage } from './files.mjs';
import { basename, join, resolve, isAbsolute } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((c) => c?.type === 'text')
          .map((c) => c.text || '')
          .join('\n')
      : '';
export const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id);
export const cwdKey = (cwd) => (process.platform === 'win32' ? resolve(cwd).toLowerCase() : resolve(cwd));

export async function validateDirectory(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > 4096 || !isAbsolute(cwd))
    throw new HttpError(400, 'Indiquez le chemin absolu d’un dossier existant.');
  const path = resolve(cwd.trim());
  if (!(await stat(path).catch(() => null))?.isDirectory())
    throw new HttpError(400, 'Ce dossier est introuvable ou inaccessible.');
  return path;
}

function selectedBranch(entries) {
  // Native entries form a tree: retain the currently selected branch.
  const nodes = new Map(entries.filter((e) => e.id && e.type !== 'session').map((e) => [e.id, e]));
  const last = entries.findLast((e) => e.id && e.type !== 'session' && Object.hasOwn(e, 'parentId'));
  let branch = entries;
  if (last) {
    branch = [];
    const visited = new Set();
    let current = last;
    while (current && !visited.has(current.id)) {
      branch.push(current);
      visited.add(current.id);
      current = nodes.get(current.parentId);
    }
    branch.reverse();
  }
  return branch;
}

function sessionMessages(entries, branch = selectedBranch(entries)) {
  const messages = [],
    calls = new Map();
  for (const e of branch) {
    const m = e.message;
    if (e.type === 'compaction' || e.type === 'branch_summary') {
      messages.push({ id: e.id, role: 'system', text: e.summary || '', timestamp: e.timestamp, tools: [] });
    }
    if (e.type === 'custom_message' && e.display) {
      messages.push({
        id: e.id,
        role: e.customType === 'session_slash_command' ? 'user' : 'system',
        text: textOf(e.content),
        tools: [],
        timestamp: e.timestamp,
      });
    }
    if (e.type !== 'message' || !m) continue;
    if (m.role === 'user' || m.role === 'assistant') {
      const content = Array.isArray(m.content) ? m.content.filter((c) => c && typeof c === 'object') : [];
      const tools = content
        .filter((c) => c.type === 'toolCall')
        .map((c) => {
          const tool = { id: c.id, name: c.name, args: c.arguments, status: 'pending' };
          calls.set(c.id, tool);
          return tool;
        });
      messages.push({
        id: e.id,
        role: m.role,
        text: splitFileMessage(imageMessageText(textOf(m.content))).text,
        thinking: content
          .filter((c) => c.type === 'thinking')
          .map((c) => c.thinking || '')
          .join('\n'),
        tools,
        timestamp: m.timestamp || e.timestamp,
        usage: m.usage,
        model: m.model,
        provider: m.provider,
        error: m.errorMessage,
        stopReason: m.stopReason,
        attachments: [
          ...imageAttachments(content),
          ...splitFileMessage(imageMessageText(textOf(m.content))).attachments,
        ],
      });
    } else if (m.role === 'toolResult') {
      let tool = calls.get(m.toolCallId);
      if (!tool) {
        tool = { id: m.toolCallId, name: m.toolName };
        messages.push({ id: e.id, role: 'assistant', text: '', tools: [tool], timestamp: e.timestamp });
      }
      Object.assign(tool, {
        result: textOf(m.content),
        isError: !!m.isError,
        status: m.isError ? 'error' : 'done',
      });
    } else if (m.role === 'bashExecution') {
      messages.push({
        id: e.id,
        role: 'assistant',
        text: '',
        tools: [
          {
            id: e.id,
            name: 'shell',
            args: { command: m.command },
            result: m.output,
            status: m.exitCode ? 'error' : 'done',
            isError: !!m.exitCode,
          },
        ],
        timestamp: e.timestamp,
      });
    } else if (m.role === 'custom' && m.display) {
      messages.push({
        id: e.id,
        role: m.customType === 'session_slash_command' ? 'user' : 'system',
        text: textOf(m.content),
        tools: [],
        timestamp: e.timestamp,
      });
    }
  }
  for (const e of entries)
    if (e.type === 'child_usage_attributed' && e.aggregateUsage) {
      const target = messages.find((m) => m.id === e.targetId);
      if (target) target.usage = e.aggregateUsage;
    }
  return messages;
}

export function createStore({ sessionDir, dataDir, initialCwd }) {
  const stateFile = join(dataDir, 'workspace.json');
  let state,
    writes = Promise.resolve();
  const cache = new Map();
  async function init() {
    if (state) return;
    try {
      state = JSON.parse(await readFile(stateFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('Impossible de lire les préférences locales : ' + error.message);
      state = { projects: [], sessions: {} };
    }
    state.projects = Array.isArray(state.projects) ? state.projects : [];
    state.sessions = state.sessions && typeof state.sessions === 'object' ? state.sessions : {};
    state.removedProjects = Array.isArray(state.removedProjects) ? state.removedProjects : [];
    if (!state.projects.length && initialCwd && !state.removedProjects.includes(cwdKey(initialCwd)))
      state.projects.push({ cwd: resolve(initialCwd), name: basename(initialCwd), pinned: true });
  }
  async function save() {
    const contents = JSON.stringify(state, null, 2) + '\n';
    const write = writes
      .catch(() => {})
      .then(async () => {
        await mkdir(dataDir, { recursive: true });
        const temp = stateFile + '.tmp';
        await writeFile(temp, contents, 'utf8');
        await rename(temp, stateFile);
      });
    writes = write;
    await write;
  }
  async function files(dir = sessionDir, depth = 0) {
    const items = await readdir(dir, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const lists = await Promise.all(
      items.map((item) =>
        item.isFile() && item.name.endsWith('.jsonl')
          ? [join(dir, item.name)]
          : item.isDirectory() && depth < 2
            ? files(join(dir, item.name), depth + 1)
            : [],
      ),
    );
    return lists.flat();
  }
  async function scan(file) {
    const info = await stat(file).catch(() => null);
    if (!info) return null;
    const existing = cache.get(file);
    if (existing?.size === info.size && existing?.mtime === info.mtimeMs) return existing.value;
    const entries = [];
    const input = createReadStream(file, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) entries.push(entry);
        } catch {}
      }
    } catch {
      return null;
    }
    const header = entries.find((e) => e.type === 'session');
    if (!header || !validId(header.id)) return null;
    const branch = selectedBranch(entries),
      messages = sessionMessages(entries, branch);
    const first = messages.find((m) => m.role === 'user' && m.text.trim());
    const named = entries.findLast((e) => e.type === 'session_info' && e.name);
    // Native context applies model changes and assistant model metadata in branch order.
    const modelEntry = branch.findLast(
      (e) =>
        e.type === 'model_change' ||
        (e.type === 'message' && e.message?.role === 'assistant' && e.message.model),
    );
    const model =
      modelEntry?.type === 'model_change'
        ? { provider: modelEntry.provider, id: modelEntry.modelId }
        : modelEntry
          ? { provider: modelEntry.message.provider, id: modelEntry.message.model }
          : null;
    const value = {
      id: header.id,
      file,
      cwd: header.cwd || null,
      title: named?.name || first?.text.replace(/\s+/g, ' ').slice(0, 100) || 'Nouvelle session',
      createdAt: header.timestamp || info.birthtime.toISOString(),
      updatedAt: info.mtime.toISOString(),
      model: model ? [model.provider, model.id].filter(Boolean).join('/') : null,
      messageCount: messages.filter((m) => m.role === 'user' || m.role === 'assistant').length,
      messages,
    };
    cache.set(file, { size: info.size, mtime: info.mtimeMs, value });
    return value;
  }
  async function all() {
    await init();
    const paths = await files();
    for (const key of cache.keys()) if (!paths.includes(key)) cache.delete(key);
    const sessions = [];
    for (let i = 0; i < paths.length; i += 12)
      sessions.push(...(await Promise.all(paths.slice(i, i + 12).map(scan))));
    return sessions.filter(Boolean).map((s) => ({ ...s, ...state.sessions[s.id] }));
  }
  async function history(id) {
    if (!validId(id)) throw new HttpError(400, 'Identifiant de session invalide.');
    const found = (await all()).find((s) => s.id === id);
    if (!found) throw new HttpError(404, 'Session introuvable.');
    return found;
  }
  async function overview() {
    const sessions = await all();
    const removed = new Set(state.removedProjects);
    const projects = new Map(
      state.projects
        .filter((p) => !removed.has(cwdKey(p.cwd)))
        .map((p) => [cwdKey(p.cwd), { ...p, sessions: [] }]),
    );
    for (const s of sessions) {
      if (!s.cwd) continue;
      const key = cwdKey(s.cwd);
      if (removed.has(key)) continue;
      if (!projects.has(key))
        projects.set(key, { cwd: s.cwd, name: basename(s.cwd), pinned: false, sessions: [] });
      const { messages, file, ...summary } = s;
      projects.get(key).sessions.push(summary);
    }
    for (const p of projects.values()) {
      p.exists = !!(await stat(p.cwd).catch(() => null))?.isDirectory();
      p.sessions.sort(
        (a, b) =>
          Number(!!b.pinned) - Number(!!a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)),
      );
    }
    return {
      projects: [...projects.values()].sort(
        (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.name.localeCompare(b.name),
      ),
      totalSessions: sessions.length,
    };
  }
  async function project(body, update = false) {
    await init();
    const cwd = await validateDirectory(body.cwd);
    const key = cwdKey(cwd);
    const patch = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100)
        throw new HttpError(400, 'Le nom doit contenir entre 1 et 100 caractères.');
      patch.name = body.name.trim();
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== 'boolean') throw new HttpError(400, 'Épinglage invalide.');
      patch.pinned = body.pinned;
    }
    let entry = state.projects.find((p) => cwdKey(p.cwd) === key);
    if (!entry) {
      entry = { cwd, name: basename(cwd), pinned: !update };
      state.projects.push(entry);
    }
    Object.assign(entry, patch);
    state.removedProjects = state.removedProjects.filter((value) => value !== key);
    await save();
    return { ...entry, exists: true, sessions: [] };
  }
  async function findProject(cwd) {
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new HttpError(400, 'Projet invalide.');
    const found = (await overview()).projects.find((p) => cwdKey(p.cwd) === cwdKey(cwd));
    if (!found) throw new HttpError(404, 'Projet introuvable.');
    return found;
  }
  async function removeProject(cwd) {
    const found = await findProject(cwd),
      key = cwdKey(found.cwd);
    state.projects = state.projects.filter((p) => cwdKey(p.cwd) !== key);
    state.removedProjects = [...new Set([...state.removedProjects, key])];
    await save();
    return { removed: true, cwd: found.cwd };
  }
  async function patchSession(body) {
    await history(body.id);
    const patch = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200)
        throw new HttpError(400, 'Le titre doit contenir entre 1 et 200 caractères.');
      patch.title = body.title.trim();
    }
    for (const key of ['pinned', 'archived'])
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'boolean') throw new HttpError(400, 'Valeur invalide.');
        patch[key] = body[key];
      }
    state.sessions[body.id] = { ...state.sessions[body.id], ...patch };
    await save();
    const { file, ...result } = await history(body.id);
    return result;
  }
  return {
    init,
    overview,
    history,
    project,
    findProject,
    removeProject,
    patchSession,
    sessionDir,
    inspectFile: scan,
  };
}
