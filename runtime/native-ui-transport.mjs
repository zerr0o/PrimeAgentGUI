// Native snapshots contain the transcript, but not pending extension UI dialogs.
// Keep those requests on the ordered socket stream when ordinary display events
// are coalesced into a snapshot. Replies still use Prime Agent's native request ID.
export function transformNativeUiTransport(source, { required } = {}) {
  let changed = false;
  const fail = () => {
    throw new Error('Prime Agent interactive transport adapter requires an update.');
  };
  const replaceOnce = (body, before, after) => {
    if (body.split(before).length !== 2) fail();
    return body.replace(before, after);
  };
  const patchMethod = (name, signature, edit) => {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...source.matchAll(new RegExp(`^([ \\t]*)${escaped} \\{[\\s\\S]*?^\\1\\}`, 'gm'))];
    if (!matches.length && required !== name && !new RegExp(`^[ \\t]*${escaped} \\{`, 'm').test(source))
      return;
    if (matches.length !== 1) fail();
    const match = matches[0];
    source = source.slice(0, match.index) + edit(match[0]) + source.slice(match.index + match[0].length);
    changed = true;
  };
  patchMethod('worker', 'broadcastToSession(state, message)', (body) => {
    body = replaceOnce(
      body,
      'const sequencedMessage = this.addSessionEventMeta(state, message);',
      'const sequencedMessage = this.addSessionEventMeta(state, message);\n' +
        'const studioDialog = primeStudioIsUiDialog(sequencedMessage);',
    );
    body = replaceOnce(
      body,
      'if (client.snapshotActiveSessionIds?.has(state.activeSessionId))',
      'if (!studioDialog && client.snapshotActiveSessionIds?.has(state.activeSessionId))',
    );
    return replaceOnce(
      body,
      'if (client.backpressured === true)',
      'if (!studioDialog && client.backpressured === true)',
    );
  });
  patchMethod('supervisor', 'handleWorkerFrame(worker, frame, source)', (body) => {
    body = replaceOnce(
      body,
      'let publicPayload = frame.payload;',
      'let publicPayload = frame.payload;\n' +
        'let studioDialog = false;\n' +
        'if (outboundType === "extension_ui_request") {\n' +
        '  try { studioDialog = primeStudioIsUiDialog(JSON.parse(frame.payload.toString("utf8"))); } catch {}\n' +
        '}',
    );
    body = replaceOnce(
      body,
      'if (client.snapshotActiveSessionIds?.has(activeSessionId))',
      'if (!studioDialog && client.snapshotActiveSessionIds?.has(activeSessionId))',
    );
    return replaceOnce(
      body,
      'if (client.backpressured === true)',
      'if (!studioDialog && client.backpressured === true)',
    );
  });
  if (changed) {
    // Only blocking dialogs bypass coalescing. Frequent status/notify updates
    // keep the native backpressure limits, routing and capability checks.
    source = `function primeStudioIsUiDialog(message) {
  return message?.type === "extension_ui_request" &&
    ["select", "input", "confirm", "editor"].includes(message.method);
}\n${source}`;
  }
  return { source, changed };
}
