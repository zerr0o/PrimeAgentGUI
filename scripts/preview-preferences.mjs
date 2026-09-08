// Isolated visual fixture: no real runtime, credentials, or LAN/Tailscale listeners.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { createLanGateway } from '../lib/lan.mjs';

export async function preferencesFixture() {
  const temp = await mkdtemp(join(tmpdir(), 'prime-preferences-preview-'));
  const cwd = join(temp, 'Projet de démonstration'),
    agentHome = join(temp, 'agent');
  const sessionDir = join(temp, 'sessions'),
    dataDir = join(temp, 'data');
  await Promise.all([cwd, agentHome, sessionDir, dataDir].map((path) => mkdir(path)));
  const app = createApp({
    initialCwd: cwd,
    agentHome,
    sessionDir,
    dataDir,
    runtime: {
      getStatus: async () => ({ available: true, version: '0.9.3 · démo' }),
      getModels: async () => ({ models: [], default: {} }),
      start: async () => {
        throw new Error('This visual fixture cannot start agents');
      },
      close: async () => {},
    },
    openDirectory: async () => {},
    networkOptions: {
      interfaces: () => ({
        'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
        Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.10.42' }],
        Tailscale: [{ family: 'IPv4', internal: false, address: '100.91.42.10' }],
      }),
      makeGateway: (options) => {
        const gateway = createLanGateway(options),
          listen = gateway.listen.bind(gateway);
        gateway.listen = (_port, _host, callback) => listen(0, '127.0.0.1', callback);
        return gateway;
      },
    },
  });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  return {
    app,
    url,
    temp,
    async close() {
      await app.close();
      if (dirname(temp) !== resolve(tmpdir())) throw new Error('Unexpected fixture directory');
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

if (process.argv.includes('--serve')) {
  const fixture = await preferencesFixture();
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/preferences-preview.json',
    JSON.stringify({ url: fixture.url, pid: process.pid, demo: true }),
  );
  console.log(`Isolated preferences preview: ${fixture.url} (demo data, loopback only)`);
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, async () => {
      await fixture.close();
      process.exit();
    });
}
