import { register } from 'node:module';
import { realpathSync } from 'node:fs';
const packageRoot = process.env.PRIME_STUDIO_KERNEL_PACKAGE;
if (packageRoot && process.env.PRIME_STUDIO_KERNEL_ROOT)
  register('./kernel-hook.mjs', import.meta.url, { data: { packageRoot: realpathSync(packageRoot) } });
