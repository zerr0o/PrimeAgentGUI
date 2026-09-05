/* Loaded only in GUI-owned agent processes via NODE_OPTIONS. Never edits Prime Agent. */
'use strict';
if (process.platform === 'win32' && process.env.PRIME_GUI_SILENT === '1') {
  require('./windows-session-leases.cjs');
  const cp = require('node:child_process');
  const { syncBuiltinESMExports } = require('node:module');
  const { join, delimiter } = require('node:path');
  const marker = Symbol.for('prime-gui.hidden-processes');
  if (!cp[marker]) {
    cp[marker] = true;
    const preload = __filename.replaceAll('\\', '/');
    const pythonPath = join(__dirname, 'python');
    function inheritEnvironment(source) {
      const env = { ...source, PRIME_GUI_SILENT: '1' };
      if (!(env.NODE_OPTIONS || '').replaceAll('\\', '/').includes(preload)) {
        env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require="${preload}"`].filter(Boolean).join(' ');
      }
      env.PYTHONPATH = [pythonPath, ...(env.PYTHONPATH || '').split(delimiter).filter(p => p && p !== pythonPath)].join(delimiter);
      return env;
    }
    // ChildProcess.spawn is shared by spawn, exec, execFile, fork and their
    // promisified variants, including callers that keep their own references.
    const spawn = cp.ChildProcess.prototype.spawn;
    cp.ChildProcess.prototype.spawn = function hiddenSpawn(options) {
      const env = Object.fromEntries((options.envPairs || []).map(pair => {
        const index = pair.indexOf('=', pair.startsWith('=') ? 1 : 0);
        return [pair.slice(0, index), pair.slice(index + 1)];
      }));
      const envPairs = Object.entries(inheritEnvironment(env)).map(([name, value]) => `${name}=${value}`);
      return spawn.call(this, { ...options, windowsHide: true, envPairs });
    };
    for (const name of ['spawnSync', 'execFileSync']) {
      const original = cp[name];
      cp[name] = function hiddenSync(command, args, options) {
        if (Array.isArray(args)) return original.call(this, command, args, { ...options, env: inheritEnvironment(options?.env || process.env), windowsHide: true });
        return original.call(this, command, { ...args, env: inheritEnvironment(args?.env || process.env), windowsHide: true });
      };
    }
    const execSync = cp.execSync;
    cp.execSync = function hiddenExecSync(command, options) {
      return execSync.call(this, command, { ...options, env: inheritEnvironment(options?.env || process.env), windowsHide: true });
    };
    // Prime Agent imports named ESM exports from node:child_process.
    syncBuiltinESMExports();
  }
}
