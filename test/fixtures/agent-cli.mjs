import { spawn } from 'node:child_process';
if (process.argv.includes('--version')) {
  console.log('0.0.0-test');
} else {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  emit({ type: 'session', id: 'test-session', cwd: process.cwd() });
  if (prompt === '[linger]') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    emit({ type: 'tool_execution_start', toolCallId: 'process', toolName: 'test', args: { pid: child.pid } });
    setInterval(() => {}, 1000);
  } else if (prompt === '[fail]') {
    emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Provider rejected this request',
      },
    });
  } else {
    emit({ type: 'message_start', message: { role: 'assistant' } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Plan' } });
    emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'toolcall_delta', delta: '{"private":"args"}' },
    });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Bonjour ☀️' } });
    emit({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'ipython', args: { code: '1+1' } });
    emit({
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'ipython',
      partialResult: { content: [{ type: 'text', text: '2' }] },
    });
    emit({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'ipython',
      result: { content: [{ type: 'text', text: '2' }] },
      isError: false,
    });
    emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Bonjour ☀️' }],
        usage: { input: 2, output: 3, totalTokens: 5, cost: { total: 0 } },
        stopReason: 'stop',
      },
    });
  }
}
