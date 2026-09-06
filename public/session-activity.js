// Read receipts stay on this browser. Inspect changed, idle histories only: file
// timestamps also change for renames/settings and are not completion signals.
const active = (run) => ['running', 'stopping'].includes(run.status);
const stamp = (session) => `${session.updatedAt || ''}:${session.messageCount ?? 0}`;

function lastAnswer(messages = []) {
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

export function createSessionActivity({ read, write, loadHistory }) {
  const pending = new Map();
  const key = (id) => `session-activity.${id}`;
  const entry = (id) => {
    const value = read(key(id), null);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  };

  function initialize(sessions) {
    if (read('session-activity.initialized', false)) return;
    // Existing conversations are the starting point, not a backlog of alerts.
    for (const session of sessions)
      if (!entry(session.id))
        write(key(session.id), { stamp: stamp(session), count: session.messageCount || 0, unread: false });
    write('session-activity.initialized', true);
  }

  function observe(history) {
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
    write(key(id), { ...previous, unread: false });
    return true;
  }

  async function sync(sessions, runs) {
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
