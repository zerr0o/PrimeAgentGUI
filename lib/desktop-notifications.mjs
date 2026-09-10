import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

// Small, in-memory event feed for the native app, independent of browser tabs.
// A cursor consumes focused/muted events too, so they never appear later in a burst.
export function createDesktopNotifications() {
  const instance = randomUUID(),
    events = [];
  let sequence = 0;
  return {
    publish(kind, run, requestId) {
      events.push({
        sequence: ++sequence,
        kind,
        runId: run.id,
        requestId,
        project: basename(run.cwd),
        status: run.status,
        createdAt: Date.now(),
      });
      if (events.length > 100) events.shift();
    },
    snapshot(after, runs) {
      return {
        instance,
        sequence,
        events: events.filter((event) => {
          if (event.sequence <= after) return false;
          if (event.kind !== 'question') return true;
          const run = runs.get(event.runId);
          return (
            run?.status === 'running' &&
            run.interactions?.some(
              (request) => request.id === event.requestId && request.status === 'pending',
            )
          );
        }),
      };
    },
  };
}
