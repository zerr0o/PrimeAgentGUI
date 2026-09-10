import { register } from 'node:module';
import { realpathSync } from 'node:fs';
const packageRoot = process.env.PRIME_GUI_CLI_ROOT;
delete process.env.PRIME_GUI_CLI_ROOT;
if (packageRoot)
  register('./studio-rpc-hook.mjs', import.meta.url, { data: { packageRoot: realpathSync(packageRoot) } });
