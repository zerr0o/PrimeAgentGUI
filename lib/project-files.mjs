import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { HttpError, cwdKey } from './store.mjs';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const PREVIEW_LIMIT = 512 * 1024;
const DOWNLOAD_LIMIT = 50 * 1024 * 1024;
const hidden = new Set(['.git', 'node_modules', '.local', '.codex-remote-attachments', '__pycache__']);
const imageTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const within = (root, path) => cwdKey(path) === cwdKey(root) || cwdKey(path).startsWith(cwdKey(root) + sep);

export function projectPath(value = '') {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f:\\]/.test(value) || isAbsolute(value))
    throw new HttpError(400, 'Chemin de fichier invalide.');
  const parts = value.split('/');
  if (
    parts.some(
      (part) => part === '..' || part === '.' || hidden.has(part.toLowerCase()) || /[. ]$/.test(part),
    )
  )
    throw new HttpError(403, 'Ce chemin n’est pas accessible dans les fichiers du projet.');
  return parts.filter(Boolean).join('/');
}

export function createProjectFiles({ store, protectedRoots = [] }) {
  const protectedPaths = protectedRoots.map((path) => resolve(path));
  const protectedPath = (path) => protectedPaths.some((root) => within(root, path));
  async function target(cwd, input = '', { missing = false } = {}) {
    const project = await store.findProject(cwd);
    const root = await realpath(project.cwd).catch(() => {
      throw new HttpError(404, 'Dossier du projet introuvable.');
    });
    const path = projectPath(input),
      absolute = join(root, path);
    let checked = absolute;
    while (true) {
      try {
        const actual = await realpath(checked);
        if (!within(root, actual)) throw new HttpError(403, 'Ce lien sort du projet.');
        projectPath(relative(root, actual).replaceAll('\\', '/'));
        if (protectedPath(actual))
          throw new HttpError(403, 'Ce dossier contient les données privées du moteur ou du Studio.');
        break;
      } catch (error) {
        if (error.status) throw error;
        if (!missing || error.code !== 'ENOENT' || checked === root)
          throw new HttpError(404, 'Fichier introuvable.');
        checked = dirname(checked);
      }
    }
    return { root, path, absolute };
  }

  async function git(root, args) {
    try {
      return (
        await exec('git', ['--no-optional-locks', '--literal-pathspecs', '-C', root, ...args], {
          windowsHide: true,
          shell: false,
          timeout: 10000,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
        })
      ).stdout;
    } catch (error) {
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        throw new HttpError(413, 'Le résultat Git est trop volumineux.');
      if (error.killed) throw new HttpError(504, 'Git met trop de temps à répondre. Réessayez.');
      throw error;
    }
  }

  async function gitRoot(root) {
    try {
      return (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    } catch (error) {
      if (error.status) throw error;
      if (error.code === 'ENOENT') return { reason: 'Git n’est pas installé sur le PC.' };
      if (/not a git repository/i.test(error.stderr || ''))
        return { reason: 'Ce projet n’est pas un dépôt Git.' };
      throw new HttpError(409, 'Impossible de consulter ce dépôt Git.');
    }
  }

  async function read(cwd, path, limit) {
    const found = await target(cwd, path);
    const handle = await open(found.absolute, 'r').catch(() => {
      throw new HttpError(404, 'Fichier introuvable.');
    });
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new HttpError(400, 'Choisissez un fichier.');
      if (info.size > limit)
        throw new HttpError(413, `Le fichier dépasse la limite de ${Math.round(limit / 1024 / 1024)} Mo.`);
      const data = Buffer.alloc(Math.min(info.size + 1, limit + 1));
      let length = 0;
      while (length < data.length) {
        const { bytesRead } = await handle.read(data, length, data.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > limit) throw new HttpError(413, 'Le fichier a grandi pendant sa lecture.');
      const after = await handle.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || length !== info.size)
        throw new HttpError(409, 'Le fichier a changé pendant sa lecture. Réessayez.');
      return {
        ...found,
        data: data.subarray(0, length),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      };
    } finally {
      await handle.close();
    }
  }

  return {
    async localFile(cwd, path) {
      const found = await target(cwd, path);
      if (!(await stat(found.absolute)).isFile()) throw new HttpError(400, 'Choisissez un fichier.');
      const actual = await realpath(found.absolute);
      if (!within(found.root, actual) || protectedPath(actual))
        throw new HttpError(403, 'Ce fichier ne se trouve pas dans le projet.');
      projectPath(relative(found.root, actual).replaceAll('\\', '/'));
      return actual;
    },
    async resolveReference(cwd, reference, basePath = '') {
      if (
        typeof reference !== 'string' ||
        !reference.trim() ||
        reference.length > 4096 ||
        /[\x00-\x1f]/.test(reference)
      )
        throw new HttpError(400, 'Référence de fichier invalide.');
      const { root } = await target(cwd);
      let input = reference.trim();
      if (/^file:/i.test(input)) {
        const url = new URL(input);
        if (url.hostname && url.hostname !== 'localhost')
          throw new HttpError(403, 'Ce fichier ne se trouve pas dans le projet.');
        input = fileURLToPath(url);
      } else {
        try {
          input = decodeURIComponent(input);
        } catch {
          throw new HttpError(400, 'Référence de fichier invalide.');
        }
      }
      input = input.replace(/(?:#L?\d+(?:[-:]L?\d+)?|:\d+(?::\d+)?)$/, '').replaceAll('\\', '/');
      if (process.platform === 'win32' && /^\/[a-z]:\//i.test(input)) input = input.slice(1);
      if (/^[a-z][\w+.-]*:/i.test(input) && !/^[a-z]:\//i.test(input))
        throw new HttpError(400, 'Référence de fichier invalide.');
      const base = basePath ? dirname(projectPath(basePath)) : '';
      const absolute = resolve(root, base, input);
      if (!within(root, absolute)) throw new HttpError(403, 'Ce fichier ne se trouve pas dans le projet.');
      const path = relative(root, absolute).replaceAll('\\', '/');
      try {
        await this.localFile(cwd, path);
        return { path };
      } catch (error) {
        if (error.status !== 404 || input.includes('/')) throw error;
      }
      // A bare filename is usable only when its project match is unambiguous.
      const matches = [],
        folders = [''];
      let visited = 0;
      const deadline = Date.now() + 1800;
      for (let i = 0; i < folders.length; i++) {
        if (Date.now() > deadline || visited > 20000)
          throw new HttpError(409, 'Indiquez le chemin du document dans le projet pour le retrouver.');
        const dir = folders[i];
        const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          visited++;
          const candidate = [dir, entry.name].filter(Boolean).join('/');
          try {
            projectPath(candidate);
          } catch {
            continue;
          }
          if (protectedPath(join(root, candidate))) continue;
          if (entry.isDirectory()) folders.push(candidate);
          if (
            entry.isFile() &&
            (process.platform === 'win32'
              ? entry.name.toLowerCase() === input.toLowerCase()
              : entry.name === input)
          ) {
            await this.localFile(cwd, candidate);
            matches.push({ path: candidate });
            if (matches.length >= 20)
              throw new HttpError(
                409,
                'Plusieurs fichiers portent ce nom. Indiquez leur chemin dans le projet.',
              );
          }
        }
      }
      if (!matches.length) throw new HttpError(404, 'Document introuvable dans ce projet.');
      return matches.length === 1 ? matches[0] : { matches };
    },
    async list(cwd, path = '', offset = 0) {
      if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'Page invalide.');
      const found = await target(cwd, path);
      if (!(await stat(found.absolute)).isDirectory()) throw new HttpError(400, 'Choisissez un dossier.');
      const entries = (await readdir(found.absolute, { withFileTypes: true }))
        .filter(
          (entry) =>
            !hidden.has(entry.name.toLowerCase()) &&
            !protectedPath(join(found.absolute, entry.name)) &&
            (entry.isDirectory() || entry.isFile()),
        )
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      return {
        path: found.path,
        total: entries.length,
        nextOffset: offset + 100 < entries.length ? offset + 100 : null,
        entries: entries.slice(offset, offset + 100).map((entry) => ({
          name: entry.name,
          path: [found.path, entry.name].filter(Boolean).join('/'),
          directory: entry.isDirectory(),
        })),
      };
    },
    async preview(cwd, path) {
      const file = await read(cwd, path, DOWNLOAD_LIMIT);
      const type = imageTypes[extname(path).toLowerCase()];
      if (type && file.size <= 8 * 1024 * 1024)
        return {
          path,
          size: file.size,
          type: 'image',
          image: `data:${type};base64,${file.data.toString('base64')}`,
        };
      if (file.size > PREVIEW_LIMIT)
        return {
          path,
          size: file.size,
          type: 'large',
          message:
            'Fichier trop volumineux pour l’aperçu. Utilisez « Ouvrir » pour le consulter sur cet appareil.',
        };
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(file.data);
      } catch {
        /* Binary file. */
      }
      if (text === undefined || text.includes('\0'))
        return {
          path,
          size: file.size,
          type: 'binary',
          message: 'Aperçu indisponible pour ce type de fichier.',
        };
      return { path, size: file.size, type: 'text', text, modifiedAt: file.modifiedAt };
    },
    async download(cwd, path) {
      const file = await read(cwd, path, DOWNLOAD_LIMIT);
      return { data: file.data, name: basename(file.path) };
    },
    async changes(cwd) {
      const { root } = await target(cwd);
      const repository = await gitRoot(root);
      if (typeof repository !== 'string') return { git: false, ...repository, entries: [] };
      const prefix = relative(repository, root).replaceAll('\\', '/');
      const toProject = (path) =>
        prefix ? (path.startsWith(prefix + '/') ? path.slice(prefix.length + 1) : null) : path;
      const raw = (
        await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])
      ).split('\0');
      const entries = [];
      for (let i = 0; i < raw.length; i++) {
        if (!raw[i]) continue;
        const status = raw[i].slice(0, 2),
          path = toProject(raw[i].slice(3));
        const previousPath = /[RC]/.test(status) ? toProject(raw[++i] || '') : undefined;
        if (path === null) continue;
        if (protectedPath(join(root, path))) continue;
        try {
          projectPath(path);
          if (previousPath) projectPath(previousPath);
        } catch {
          continue;
        }
        entries.push({
          path,
          status,
          previousPath,
          staged: ![' ', '?'].includes(status[0]),
          untracked: status === '??',
          deleted: status.includes('D'),
        });
      }
      let branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
      if (!branch || branch === 'HEAD')
        branch = (await git(root, ['symbolic-ref', '--short', 'HEAD']).catch(() => 'HEAD détachée')).trim();
      return {
        git: true,
        branch,
        entries: entries.slice(0, 1000),
        total: entries.length,
        truncated: entries.length > 1000,
      };
    },
    async diff(cwd, path) {
      const { root } = await target(cwd, path, { missing: true });
      const changes = await this.changes(cwd);
      const change = changes.entries.find((entry) => entry.path === path);
      if (!change) throw new HttpError(404, 'Cette modification n’est plus présente. Actualisez la liste.');
      const hasHead = await git(root, ['rev-parse', '--verify', 'HEAD']).then(
        () => true,
        () => false,
      );
      if (change.untracked || !hasHead) {
        if (change.deleted) return { path, text: '', message: 'Fichier supprimé dans un dépôt sans commit.' };
        const preview = await this.preview(cwd, path);
        if (preview.type !== 'text')
          return { path, text: '', message: 'Le contenu de ce fichier ne peut pas être affiché en diff.' };
        const lines = preview.text.split('\n');
        if (lines.at(-1) === '') lines.pop();
        return {
          path,
          text: `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => '+' + line).join('\n')}`,
          newFile: true,
        };
      }
      if (change.previousPath) await target(cwd, change.previousPath, { missing: true });
      const text = await git(root, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--no-renames',
        '--unified=3',
        'HEAD',
        '--',
        path,
        ...(change.previousPath ? [change.previousPath] : []),
      ]);
      return {
        path,
        text,
        message: text
          ? undefined
          : 'Le contenu final est identique à HEAD ; des changements peuvent encore être présents dans l’index.',
      };
    },
  };
}
