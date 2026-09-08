// Server receipts are authoritative across devices. Inspect changed, idle histories only: file
// timestamps also change for renames/settings and are not completion signals.
const active = (run) => ['running', 'stopping'].includes(run.status);
const stamp = (session) => `${session.updatedAt || ''}:${session.messageCount ?? 0}`;

export function lastAnswer(messages = []) {
  const conversation = messages.filter((message) => ['user', 'assistant'].includes(message.role));
  const index = conversation.findLastIndex(
    (message) =>
      message.role === 'assistant' &&
      !message.error &&
      !message.tools?.length &&
      (!message.stopReason || ['stop', 'length'].includes(message.stopReason)) &&
      Boolean(message.text?.trim() || message.thinking?.trim()),
  );
  const message = conversation[index];
  return message ? { id: message.id || `${message.timestamp}:${index}`, index } : null;
}

export function createSessionActivity({ read, write, loadHistory, saveRead, onChange = () => {} }) {
  const pending = new Map();
  const reading = new Map();
  const key = (id) => `session-activity.${id}`;
  const entry = (id) => {
    const value = read(key(id), null);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  };
  function observeShared(session) {
    const remote = session.readState;
    if (!remote) return false;
    const previous = entry(session.id);
    // History snapshots and receipts can arrive out of order independently.
    // A receipt acknowledgement has no history metadata and must not replace a newer answer.
    const current = {
      ...previous,
      ...(!previous ||
      (session.updatedAt && !(Date.parse(previous.updatedAt) > Date.parse(session.updatedAt)))
        ? {
            stamp: session.messages ? stamp(session) : previous?.stamp,
            updatedAt: session.updatedAt,
            answer: remote.answer,
          }
        : {}),
      ...((previous?.revision || 0) <= remote.revision
        ? { read: remote.read, revision: remote.revision }
        : {}),
    };
    current.unread = Boolean(
      current.answer && current.answer !== current.read && reading.get(session.id) !== current.answer,
    );
    write(key(session.id), current);
    return true;
  }

  function initialize(sessions) {
    for (const session of sessions) observeShared(session);
    if (read('session-activity.initialized', false)) return;
    // Existing conversations are the starting point, not a backlog of alerts.
    for (const session of sessions)
      if (!entry(session.id))
        write(key(session.id), { stamp: stamp(session), count: session.messageCount || 0, unread: false });
    write('session-activity.initialized', true);
  }

  function observe(history) {
    if (observeShared(history)) return;
    const previous = entry(history.id) || { answer: '', count: 0, unread: false };
    // Another tab may already have inspected/read a more recent snapshot.
    if (Date.parse(previous.updatedAt) > Date.parse(history.updatedAt)) return;
    const answer = lastAnswer(history.messages);
    const changed =
      answer &&
      (previous.answer === undefined ? answer.index >= previous.count : answer.id !== previous.answer);
    write(key(history.id), {
      stamp: stamp(history),
      updatedAt: history.updatedAt,
      count: history.messageCount || 0,
      answer: answer?.id || '',
      unread: Boolean(answer && (previous.unread || changed)),
    });
  }

  function markRead(id, messages) {
    const previous = entry(id);
    if (!previous?.unread || previous.answer !== lastAnswer(messages)?.id) return false;
    if (saveRead && previous.revision) {
      if (reading.has(id)) return false;
      reading.set(id, previous.answer);
      write(key(id), { ...previous, unread: false });
      Promise.resolve()
        .then(() => saveRead(id, previous.answer))
        .then((result) => {
          reading.delete(id);
          // Keep the stamp: a receipt response need not contain history metadata.
          observeShared({ id, readState: result.readState });
          onChange();
        })
        .catch(() => {
          reading.delete(id);
          const current = entry(id);
          if (current)
            write(key(id), {
              ...current,
              unread: Boolean(current.answer && current.answer !== current.read),
            });
          onChange();
        });
      return true;
    }
    write(key(id), { ...previous, unread: false });
    return true;
  }

  async function sync(sessions, runs) {
    for (const session of sessions) observeShared(session);
    const running = new Set(runs.filter(active).map((run) => run.sessionId));
    const queue = sessions.filter(
      (session) => !running.has(session.id) && entry(session.id)?.stamp !== stamp(session),
    );
    const histories = [];
    // Keep startup/navigation responsive even with a large session archive.
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) {
          const session = queue.shift();
          let request = pending.get(session.id);
          if (!request) {
            request = loadHistory(session.id)
              .then((history) => {
                observe(history);
                return history;
              })
              .finally(() => pending.delete(session.id));
            pending.set(session.id, request);
          }
          try {
            histories.push(await request);
          } catch {
            /* Retry on the next overview. */
          }
        }
      }),
    );
    return histories;
  }

  return { initialize, observe, markRead, sync, isUnread: (id) => entry(id)?.unread === true };
}
