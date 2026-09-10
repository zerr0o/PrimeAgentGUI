import { discoverCli, agentEnvironment } from '../lib/agent.mjs';
import { ensureLocalKernel } from '../lib/kernel.mjs';

try {
  const cli = discoverCli();
  if (!cli?.packageDir) throw new Error('Prime Agent introuvable. Définissez PRIME_AGENT_CLI vers cli.js.');
  const python = await ensureLocalKernel({
    packageDir: cli.packageDir,
    root: process.env.PRIME_AGENT_GUI_KERNEL_ROOT,
    env: agentEnvironment(),
    cwd: process.argv[2] || process.cwd(),
    onProgress: (message) => console.log(message),
  });
  console.log(`Python vérifié : ${python}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
