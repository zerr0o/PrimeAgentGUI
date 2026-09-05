// Deliberately tiny protocol fixture; records discovery without executing any tool.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const audit = process.argv[2];
appendFileSync(
  audit,
  JSON.stringify({
    pid: process.pid,
    cwd: process.cwd(),
    environmentResolved: process.env.TOKEN === 'fixture-private-token',
  }) + '\n',
);
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  const message = JSON.parse(line);
  appendFileSync(audit, JSON.stringify({ method: message.method }) + '\n');
  if (message.id === undefined) return;
  const result =
    message.method === 'initialize'
      ? {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'studio-fixture', version: '1' },
        }
      : message.method === 'tools/list'
        ? {
            tools: [
              {
                name: 'lookup',
                description: 'Chercher une entrée.',
                inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
              },
              {
                name: 'delete',
                description: 'Ne doit jamais être appelé par un test.',
                inputSchema: { type: 'object' },
              },
            ],
          }
        : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
});
