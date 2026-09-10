import { register } from 'node:module';
import { realpathSync } from 'node:fs';
const packageRoot = process.env.PRIME_STUDIO_SESSION_PACKAGE;
if (packageRoot)
  register('./session-preferences.mjs', import.meta.url, {
    data: { packageRoot: realpathSync(packageRoot) },
  });
