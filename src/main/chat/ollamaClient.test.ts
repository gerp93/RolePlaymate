import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { OllamaClient } from './ollamaClient';

test('time to first word counts the wait before the server says anything, not just what follows', async () => {
  // A server that, like Ollama reading a long prompt, sends nothing -- not even headers -- for 300ms.
  const server = http.createServer((req, res) => {
    req.resume();
    setTimeout(() => {
      res.write(JSON.stringify({ message: { content: 'Hello' }, done: false }) + '\n');
      res.end(
        JSON.stringify({
          message: { content: '' },
          done: true,
          eval_count: 1,
          prompt_eval_count: 1,
          eval_duration: 1e6,
          prompt_eval_duration: 2e8,
          load_duration: 1e8,
          total_duration: 4e8,
        }) + '\n'
      );
    }, 300);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const client = new OllamaClient(() => `http://127.0.0.1:${port}`);
    const result = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], onToken: () => {} });
    assert.ok(result.timings, 'timings reported');
    assert.ok((result.timings.firstTokenMs ?? 0) >= 250, `first token was ${result.timings.firstTokenMs}ms`);
    // Ollama's own counters come through in milliseconds.
    assert.equal(result.timings.loadMs, 100);
    assert.equal(result.timings.promptEvalMs, 200);
    assert.equal(result.timings.evalMs, 1);
  } finally {
    server.close();
  }
});
