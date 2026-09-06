import { register } from 'node:module';
import { realpathSync } from 'node:fs';
const packageRoot = process.env.PRIME_STUDIO_POLICY_CLI_ROOT;
// Inherited only by Studio-owned daemons/workers; ordinary installed CLI sessions are untouched.
if (packageRoot && process.env.PRIME_STUDIO_SUBAGENT_POLICY)
  register('./subagent-hook.mjs', import.meta.url, { data: { packageRoot: realpathSync(packageRoot) } });
