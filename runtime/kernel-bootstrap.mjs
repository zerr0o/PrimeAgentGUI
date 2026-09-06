import { ensureLocalKernel } from '../lib/kernel.mjs';

// The native session supplies its actual activated Python skills here, including
// in children, changed working directories and resumed kernels. A shared daemon
// must not freeze the first project's Python for all its future workers.
export function prepareKernel(options = {}) {
  return ensureLocalKernel({
    packageDir: process.env.PRIME_STUDIO_KERNEL_PACKAGE,
    root: process.env.PRIME_STUDIO_KERNEL_ROOT,
    env: process.env,
    pythonSkills: options.pythonSkills || [],
    onProgress: options.onProgress,
  });
}
