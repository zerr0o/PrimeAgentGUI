/* Parent-only IPC invokes Prime Agent's own graceful headless shutdown handler. */
'use strict';

if (process.env.PRIME_GUI_CONTROL === '1' && typeof process.send === 'function') {
  // Delegated agents and daemon processes must never inherit the control role.
  delete process.env.PRIME_GUI_CONTROL;
  let requested = false;
  let delivered = false;
  let timer;
  function deliver() {
    if (!requested || delivered) return;
    if (process.listenerCount('SIGTERM') > 0) {
      delivered = true;
      clearTimeout(timer);
      process.emit('SIGTERM');
    } else {
      // A cancellation can arrive before print mode installs its cleanup handler.
      timer = setTimeout(deliver, 25);
      timer.unref();
    }
  }
  process.on('message', (message) => {
    if (message?.type !== 'prime-studio:cancel' || message.version !== 1) return;
    requested = true;
    deliver();
  });
  // Merely having an IPC channel must not keep a completed CLI alive.
  process.channel?.unref();
}
