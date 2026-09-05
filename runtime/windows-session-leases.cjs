/* Compatibility for Prime Agent's guarded session lease acquisition on Windows. */
'use strict';

if (process.platform === 'win32' && process.env.PRIME_GUI_SILENT === '1') {
  const fs = require('node:fs');
  const path = require('node:path');
  const { syncBuiltinESMExports } = require('node:module');
  const marker = Symbol.for('prime-gui.windows-session-leases');

  if (!fs[marker]) {
    fs[marker] = true;
    const renameSync = fs.renameSync;

    function isLeaseCollision(source, destination) {
      if (typeof source !== 'string' || typeof destination !== 'string') return false;
      const target = path.resolve(destination);
      const candidate = path.resolve(source);
      if (path.basename(path.dirname(target)) !== 'session-leases') return false;
      if (!/^[a-f0-9]{64}\.lock$/.test(path.basename(target))) return false;
      if (!candidate.startsWith(`${target}.candidate-${process.pid}-`)) return false;
      if (!/^[a-f0-9-]{36}$/.test(candidate.slice(`${target}.candidate-${process.pid}-`.length))) {
        return false;
      }
      try {
        return fs.lstatSync(candidate).isDirectory() && fs.lstatSync(target).isDirectory();
      } catch {
        return false;
      }
    }

    fs.renameSync = function renameSessionLease(source, destination) {
      try {
        return renameSync.call(this, source, destination);
      } catch (error) {
        // Windows reports EPERM when renaming a directory over an existing
        // directory. Prime Agent expects EEXIST/ENOTEMPTY before checking its
        // owner's PID and start time under its own lease guard. Normalize only
        // this exact candidate collision; native code still decides whether the
        // owner is alive and is solely responsible for reclaiming stale leases.
        if (error?.code === 'EPERM' && isLeaseCollision(source, destination)) error.code = 'EEXIST';
        throw error;
      }
    };

    // The installed CLI bundles use named imports from node:fs.
    syncBuiltinESMExports();
  }
}
