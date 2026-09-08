import { register } from 'node:module';
import { realpathSync } from 'node:fs';
const packageRoot = process.env.PRIME_STUDIO_TRANSPORT_PACKAGE;
if (packageRoot)
  register('./transport-hook.mjs', import.meta.url, { data: { packageRoot: realpathSync(packageRoot) } });
