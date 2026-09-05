import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (child) => child?.pid && child.exitCode === null && child.signalCode === null;

async function terminateOwnedChild(child) {
  if (!alive(child)) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile(
        join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, shell: false, timeout: 10000 },
        resolve,
      );
    });
  }
  if (alive(child)) child.kill('SIGKILL');
}

/** Each GUI runtime owns a separate supervisor, never the user's default daemon. */
export function createOwnedDaemon(options, dependencies = {}) {
  const { cli, env, cwd = process.cwd(), onDiagnostic } = options;
  if (!cli?.packageDir) throw new Error('Le dossier de Prime Agent est introuvable.');
  const spawnProcess = dependencies.spawnProcess || spawn;
  const terminateProcess = options.terminateProcess || terminateOwnedChild;
  const timeout = options.startupTimeout ?? 30000;
  const closeTimeout = options.closeTimeout ?? 7000;
  const namespace = `prime-studio-${process.pid}-${randomUUID()}`;
  const socketPath =
    process.platform === 'win32' ? `\\\\.\\pipe\\${namespace}` : join(tmpdir(), `${namespace}.sock`);
  let Client;
  const loadClient =
    dependencies.loadClient ||
    (async () => {
      Client ||= (
        await import(pathToFileURL(join(cli.packageDir, 'dist/modes/daemon/daemon-client.js')).href)
      ).DaemonClient;
      return Client;
    });
  let child;
  let startPromise;
  let closePromise;
  let closing = false;
  let started = false;
  let verifiedNamespace = false;
  let supervisorPid;

  function diagnostic(kind, message) {
    try {
      onDiagnostic?.({ kind, message: String(message).slice(-8000), socketPath });
    } catch {
      // Logging must never interfere with process ownership.
    }
  }

  async function startInner() {
    const DaemonClient = await loadClient();
    if (closing) throw new Error('Le moteur est en cours d’arrêt.');
    // Native clients can recover a dead supervisor before the next GUI run.
    // Trust that successor only after this private namespace was authenticated
    // against our original ChildProcess. Never adopt a peer on the first start.
    if (verifiedNamespace && !alive(child)) {
      const client = new DaemonClient(socketPath);
      try {
        await client.connect(Math.min(500, timeout));
        const hello = await client.waitForHello(Math.min(1500, timeout));
        if (!Number.isInteger(hello.supervisorPid) || hello.supervisorPid <= 0) {
          const error = new Error('Le moteur de récupération ne fournit pas une identité valide.');
          error.code = 'GUI_DAEMON_IDENTITY_MISMATCH';
          throw error;
        }
        if (closing) throw new Error('Le moteur est en cours d’arrêt.');
        supervisorPid = hello.supervisorPid;
        return { pid: supervisorPid, socketPath };
      } catch (error) {
        if (closing || error.code === 'GUI_DAEMON_IDENTITY_MISMATCH') throw error;
        // No responsive successor: launch another child that we can verify.
      } finally {
        client.close();
      }
    }
    const launchEnv = { ...env };
    // A GUI launched inside an agent must not inherit that worker's identity.
    for (const name of Object.keys(launchEnv)) {
      if (
        /^PRIME_AGENT_INTERNAL_(?:DAEMON_WORKER|DAEMON_CATALOG|SESSION_LEASE|ORPHAN_PROCESS)/.test(name) ||
        name === 'PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_SOCKET' ||
        name === 'PRIME_GUI_CONTROL'
      )
        delete launchEnv[name];
    }
    const args = ['--mode', 'daemon', '--daemon-socket', socketPath];
    const current = spawnProcess(
      cli.node ? process.execPath : cli.path,
      cli.node ? [cli.path, ...args] : args,
      {
        cwd,
        env: launchEnv,
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child = current;
    started = true;
    let failure;
    let output = '';
    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-8000);
    };
    current.stdout?.on('data', capture);
    current.stderr?.on('data', capture);
    current.on('error', (error) => {
      failure = error;
    });
    current.on('exit', (code, signal) => {
      if (current === child) startPromise = undefined;
      if (!closing && code !== 0) diagnostic('daemon_exit', output || `Moteur arrêté (${code ?? signal}).`);
    });
    const deadline = Date.now() + timeout;
    try {
      while (!closing && Date.now() < deadline) {
        if (failure) throw failure;
        if (!alive(current)) throw new Error(output || 'Le moteur Prime Agent s’est arrêté au démarrage.');
        const client = new DaemonClient(socketPath);
        try {
          await client.connect(Math.min(500, Math.max(1, deadline - Date.now())));
          const hello = await client.waitForHello(Math.min(1500, Math.max(1, deadline - Date.now())));
          if (hello.supervisorPid !== current.pid) {
            verifiedNamespace = false;
            const error = new Error('Le moteur ne correspond pas au processus lancé par le studio.');
            error.code = 'GUI_DAEMON_IDENTITY_MISMATCH';
            throw error;
          }
          verifiedNamespace = true;
          supervisorPid = current.pid;
          return { pid: current.pid, socketPath };
        } catch (error) {
          if (error.code === 'GUI_DAEMON_IDENTITY_MISMATCH') throw error;
        } finally {
          client.close();
        }
        await sleep(100);
      }
      throw new Error(
        closing
          ? 'Le moteur est en cours d’arrêt.'
          : `Prime Agent ne répond pas au démarrage.${output ? ` ${output}` : ''}`,
      );
    } catch (error) {
      await terminateProcess(current);
      throw error;
    }
  }

  function ensureReady() {
    if (closing) return Promise.reject(new Error('Le moteur est en cours d’arrêt.'));
    if (!startPromise) {
      startPromise = startInner().then(
        (result) => {
          // Recovered supervisors are not our ChildProcess, so there is no exit
          // event to invalidate readiness. Probe that namespace on every run.
          if (!alive(child)) startPromise = undefined;
          return result;
        },
        (error) => {
          startPromise = undefined;
          throw error;
        },
      );
    }
    return startPromise;
  }

  async function closeInner() {
    closing = true;
    await startPromise?.catch(() => {});
    if (!started) return;
    if (!verifiedNamespace) {
      await terminateProcess(child);
      return;
    }
    let client;
    try {
      const DaemonClient = await loadClient();
      client = new DaemonClient(socketPath);
      await client.connect(1000);
      await client.waitForHello(1500);
      // Public `prime-agent shutdown` stops every daemon. This request is scoped
      // to the unguessable namespace allocated by this runtime, including recovery.
      const response = await client.request({ type: 'shutdown', force: true }, 2500);
      if (!response.success) diagnostic('daemon_shutdown', response.error);
    } catch (error) {
      if (alive(child)) diagnostic('daemon_shutdown', error.message);
    } finally {
      client?.close();
    }
    const deadline = Date.now() + closeTimeout;
    while (alive(child) && Date.now() < deadline) await sleep(50);
    await terminateProcess(child);
  }

  return {
    socketPath,
    get pid() {
      return supervisorPid ?? child?.pid;
    },
    ensureReady,
    close() {
      return (closePromise ||= closeInner());
    },
  };
}
