// Injectable CLI emulator. Never launches Tailscale or opens external listeners.
export function fakeTailscale() {
  let serve = {},
    mode = 'ready';
  const calls = [];
  const origin = 'https://studio.taildemo.ts.net',
    authority = 'studio.taildemo.ts.net:443';
  return {
    calls,
    origin,
    setMode: (value) => (mode = value),
    setServe: (value) => (serve = structuredClone(value)),
    getServe: () => structuredClone(serve),
    async run(args) {
      calls.push(args);
      if (mode === 'missing') throw Object.assign(new Error('not installed'), { code: 'ENOENT' });
      if (args[0] === 'status')
        return JSON.stringify({
          BackendState: mode === 'offline' ? 'Stopped' : 'Running',
          Self: { DNSName: 'studio.taildemo.ts.net.' },
          CurrentTailnet: { MagicDNSEnabled: mode !== 'dns' },
        });
      if (args[1] === 'status') return JSON.stringify(serve);
      if (mode === 'approval')
        throw Object.assign(new Error('needs authorization'), {
          stdout: 'Enable at https://login.tailscale.com/f/serve?node=demo',
        });
      if (args.at(-1) === 'off') serve = {};
      else
        serve = {
          TCP: { 443: { HTTPS: true } },
          Web: { [authority]: { Handlers: { '/': { Proxy: args.at(-1) } } } },
        };
      return '';
    },
  };
}
