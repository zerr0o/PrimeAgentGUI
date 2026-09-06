// Native auth owns its locks and callbacks in this hidden, isolated process.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { createProviderAuth } from '../lib/provider-auth.mjs';
const input = createInterface({ input: process.stdin });
const emit = (data) => process.stdout.write(JSON.stringify(data) + '\n');
const finishOutput = (data) =>
  new Promise((resolve) => process.stdout.write(JSON.stringify(data) + '\n', resolve));
const pending = new Map();
let started = false;
function ask(kind, details = {}) {
  const id = randomUUID();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    emit({ type: 'prompt', prompt: { id, kind, ...details } });
  });
}
input.on('line', (line) => {
  try {
    const data = JSON.parse(line);
    if (!started) {
      started = true;
      void run(data);
    } else if (data.type === 'answer' && pending.has(data.id)) {
      pending.get(data.id)(data.value);
      pending.delete(data.id);
    }
  } catch {
    process.exit(1);
  }
});
input.on('close', () => {
  if (!started) process.exit(0);
});
async function run({ agentHome, operation, body }) {
  try {
    const store = await createProviderAuth({ agentHome });
    let result;
    if (operation === 'list') result = store.list();
    else if (operation === 'save' || operation === 'remove') {
      const entry = store.entry(body);
      await ask('commit', { replacing: entry.configured || entry.stored });
      result = operation === 'save' ? await store.save(body) : store.remove(body);
    } else if (operation === 'login')
      result = await store.login(
        body,
        {
          onAuth: (info) => emit({ type: 'auth', url: info.url, instructions: info.instructions }),
          onPrompt: (prompt) =>
            ask('text', {
              message: prompt.message,
              placeholder: prompt.placeholder,
              allowEmpty: prompt.allowEmpty === true,
            }),
          onManualCodeInput: () =>
            ask('manual', {
              message: 'Si le retour automatique ne fonctionne pas, collez le code ou l’adresse de retour.',
            }),
          onSelect: (prompt) => ask('select', { message: prompt.message, options: prompt.options }),
          onProgress: () => {},
        },
        (entry) => ask('commit', { replacing: entry.configured || entry.stored }),
      );
    else throw new Error('Unknown operation');
    await finishOutput({ type: 'result', result });
  } catch (error) {
    await finishOutput({
      type: 'error',
      status: error.status || 502,
      error: error.status
        ? error.message
        : 'Connexion impossible. Vérifiez vos identifiants et réessayez. Les connexions existantes ont été conservées.',
    });
  } finally {
    input.close();
    process.stdin.destroy();
    process.exit(0);
  }
}
