// Explicit, opt-in integration check. This invokes the user's configured Luna account.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentRuntime } from '../lib/agent.mjs';
import { createStore } from '../lib/store.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = resolve(root, '.local', 'smoke-workspace');
const sessionDir = resolve(root, '.local', 'smoke-sessions');
await mkdir(directory, { recursive: true });
const runtime = createAgentRuntime({ sessionDir });
const events = [];
let handle;
const timeout = setTimeout(() => void handle?.cancel(), 120000);
try {
  handle = await runtime.start({
    cwd: directory,
    model: 'openai-codex/gpt-5.6-luna',
    thinking: 'low',
    message: `Effectue uniquement ce test technique local, sans lire ni modifier de fichier et sans déléguer. Dans un unique appel à ton outil Python, exécute exactement :\nimport subprocess, os\nassert os.environ.get('PRIME_GUI_SILENT') == '1'\nassert getattr(subprocess.Popen, '_prime_gui_hidden', False), 'Le correctif de fenêtres est absent'\nresult = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', "Write-Output 'PRIME_GUI_SILENT_OK'"], capture_output=True, text=True, check=True)\nprint(result.stdout.strip())\nPuis réponds uniquement PRIME_GUI_SILENT_OK si cet appel a réussi.`,
    onEvent: (event) => {
      events.push(event);
      if (['session', 'tool_start', 'tool_end', 'done'].includes(event.kind))
        console.log(
          JSON.stringify({
            kind: event.kind,
            id: event.sessionId || event.id,
            name: event.name,
            status: event.status,
            error: event.error,
            isError: event.isError,
          }),
        );
    },
  });
  const result = await handle.done;
  const passed =
    result.status === 'completed' &&
    events.some(
      (e) => e.kind === 'tool_end' && !e.isError && JSON.stringify(e.result).includes('PRIME_GUI_SILENT_OK'),
    );
  let resumePassed = false;
  if (passed) {
    const resumed = [];
    // Native 0.9.1 may use a different filename UUID than the header UUID.
    const store = createStore({ sessionDir, dataDir: join(root, '.local', 'smoke-metadata') });
    const session = await store.history(result.sessionId);
    handle = await runtime.start({
      cwd: directory,
      sessionId: result.sessionId,
      sessionFile: session.file,
      model: 'openai-codex/gpt-5.6-luna',
      thinking: 'low',
      message:
        'Sans utiliser aucun outil, réponds uniquement avec le marqueur exact imprimé par la commande PowerShell de notre échange précédent.',
      onEvent: (event) => resumed.push(event),
    });
    const continuation = await handle.done;
    resumePassed =
      continuation.status === 'completed' &&
      continuation.sessionId === result.sessionId &&
      resumed.some(
        (e) =>
          e.kind === 'message' &&
          e.message.role === 'assistant' &&
          e.message.text.includes('PRIME_GUI_SILENT_OK'),
      );
  }
  const report = {
    at: new Date().toISOString(),
    model: 'openai-codex/gpt-5.6-luna',
    passed: passed && resumePassed,
    resumePassed,
    sessionId: result.sessionId,
    status: result.status,
    tools: events
      .filter((e) => e.kind === 'tool_end')
      .map((e) => ({ name: e.name, isError: e.isError, result: e.result })),
    error: result.error,
  };
  await writeFile(join(root, '.local', 'luna-smoke-result.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      passed: report.passed,
      resumePassed,
      status: result.status,
      sessionId: result.sessionId,
    }),
  );
  if (!report.passed) process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await runtime.close();
}
