import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const env = { ...process.env };
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
const localKey = join(homedir(), '.tauri', 'prime-agent-studio.key');
if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(localKey)) env.TAURI_SIGNING_PRIVATE_KEY = localKey;
if (!args.includes('--no-bundle') && !env.TAURI_SIGNING_PRIVATE_KEY)
  throw new Error('Signing key required: set TAURI_SIGNING_PRIVATE_KEY. See docs/desktop.md.');
const result = spawnSync(
  process.execPath,
  [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', ...args],
  { cwd: root, env, stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
