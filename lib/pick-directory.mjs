import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { formatMessage as tr } from '../public/i18n-core.js';
import { HttpError, validateDirectory } from './store.mjs';

const helper = fileURLToPath(new URL('../scripts/pick-directory.ps1', import.meta.url));

export function createDirectoryPicker({
  platform = process.platform,
  env = process.env,
  run = promisify(execFile),
} = {}) {
  let controller;
  return {
    async pick({ cwd, title, signal } = {}) {
      if (platform !== 'win32') throw new HttpError(501, tr('folders.windows_only'));
      if (signal?.aborted) return { cwd: null };
      if (controller) throw new HttpError(409, tr('folders.already_open'));
      const current = new AbortController();
      controller = current;
      const abort = () => current.abort();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const initial = cwd ? await validateDirectory(cwd).catch(() => '') : '';
        current.signal.throwIfAborted();
        // PowerShell 7 provides the modern Explorer picker; Windows PowerShell
        // remains a supported fallback without installing an extra dependency.
        const modern = join(env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
        const command = existsSync(modern)
          ? modern
          : join(env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
        const { stdout } = await run(
          command,
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', helper],
          {
            shell: false,
            windowsHide: true,
            signal: current.signal,
            timeout: 300000,
            maxBuffer: 16384,
            encoding: 'utf8',
            env: {
              ...env,
              PRIME_STUDIO_PICK_DIRECTORY: initial,
              PRIME_STUDIO_PICK_TITLE: title || tr('folders.choose'),
            },
          },
        );
        if (signal?.aborted) return { cwd: null };
        const result = JSON.parse(stdout.trim());
        if (result.cwd === null) return { cwd: null };
        return { cwd: await validateDirectory(result.cwd) };
      } catch {
        if (signal?.aborted) return { cwd: null };
        throw new HttpError(502, tr('folders.picker_failed'));
      } finally {
        signal?.removeEventListener('abort', abort);
        if (controller === current) controller = undefined;
      }
    },
    close() {
      controller?.abort();
    },
  };
}
