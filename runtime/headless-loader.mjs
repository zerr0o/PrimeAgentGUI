import { register } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

// Only the GUI's print client receives this marker. Its workers inherit neither
// this registration nor the marker, even when Node forwards --import arguments.
const packageRoot = process.env.PRIME_GUI_CLI_ROOT;
delete process.env.PRIME_GUI_CLI_ROOT;
if (packageRoot) {
  register('./headless-hook.mjs', import.meta.url, {
    data: { packageRoot: realpathSync(resolve(packageRoot)) },
  });
}
