import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = join(root, '.local', 'generated-desktop-icons'),
  destination = join(root, 'src-tauri', 'icons');
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
    'icon',
    join(root, 'assets/prime-agent.svg'),
    '--output',
    generated,
  ],
  { windowsHide: true, stdio: 'inherit' },
);
await mkdir(destination, { recursive: true });
const ico = await readFile(join(generated, 'icon.ico'));
const entries = Array.from({ length: ico.readUInt16LE(4) }, (_, i) =>
  Buffer.from(ico.subarray(6 + i * 16, 22 + i * 16)),
);
// Tauri's ICO decoder uses entry zero for WM_SETICON. Keep the vector-rendered 256px image first;
// the EXE still includes all sizes so Windows can select the best image for its current DPI.
entries.sort((a, b) => (b[0] || 256) - (a[0] || 256));
entries.forEach((entry, i) => entry.copy(ico, 6 + i * 16));
await writeFile(join(destination, 'icon.ico'), ico);
for (const file of ['32x32.png', '128x128.png', '128x128@2x.png'])
  await cp(join(generated, file), join(destination, file));
