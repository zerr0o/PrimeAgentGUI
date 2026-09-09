// UI-only native adapter. Never runs an installer or stops a process.
export async function mockDesktopUpdates(context) {
  await context.addInitScript(() => {
    window.__PRIME_STUDIO_DESKTOP__ = true;
    window.updateFixture = { activeRuns: 2, managed: true, mode: 'available', calls: [] };
    window.__TAURI__ = {
      core: {
        Channel: class {},
        invoke: async (command, args) => {
          const fixture = window.updateFixture;
          fixture.calls.push({ command, force: args?.force, restartServer: args?.restartServer });
          if (command === 'desktop_update_status')
            return {
              appVersion: '2.9.3',
              version: '2.9.2',
              running: true,
              managed: fixture.managed,
              activeRuns: fixture.activeRuns,
            };
          if (command === 'desktop_update_check') {
            if (fixture.mode === 'offline') throw 'check_failed';
            return {
              available: fixture.mode !== 'current',
              version: '2.9.4',
              notes:
                'Amélioration des mises à jour et des interactions Windows.\n<img src=x onerror=alert(1)>',
            };
          }
          if (command === 'desktop_update_install') {
            if (fixture.mode === 'invalid') throw 'download_failed';
            fixture.channel = args.onEvent;
            args.onEvent.onmessage({ stage: 'downloading', percent: 42 });
            return new Promise(() => {});
          }
          if (command === 'desktop_server_restart') {
            if (fixture.mode === 'race') return { reason: 'agents_running' };
            return { restarted: true };
          }
          throw new Error('Unexpected fixture command: ' + command);
        },
      },
    };
  });
}
