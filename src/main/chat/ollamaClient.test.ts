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

// ---- strict-alternation templates -----------------------------------------------------------------

import { OllamaUnavailableError } from './ollamaClient';

/** A server that behaves like Ollama with a Mistral-style template: HTTP 400 unless, after the system message,
 * the roles start with the user and alternate. Records every request body it sees. */
function strictServer(): { server: http.Server; seen: { model: string; roles: string }[] } {
  const seen: { model: string; roles: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = JSON.parse(body) as { model: string; messages: { role: string }[]; stream: boolean };
      const roles = parsed.messages.map((m) => m.role[0]).join('');
      seen.push({ model: parsed.model, roles });
      const rest = parsed.messages.filter((m) => m.role !== 'system');
      const alternates = rest.every((m, i) => (m.role === 'user') === (i % 2 === 0));
      if (parsed.model.startsWith('strict') && !alternates) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: JSON.stringify({
              error: {
                code: 400,
                message:
                  'Unable to generate parser for this template. raise_exception("After the optional system message, conversation roles must alternate user/assistant/user/assistant/...")',
              },
            }),
          })
        );
        return;
      }
      if (parsed.model === 'broken') {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'something else is wrong' }));
        return;
      }
      if (!parsed.stream) {
        res.end(JSON.stringify({ message: { content: 'Hi' }, done: true, eval_count: 1, prompt_eval_count: 1 }));
        return;
      }
      res.write(JSON.stringify({ message: { content: 'Hi' }, done: false }) + '\n');
      res.end(JSON.stringify({ message: { content: '' }, done: true, eval_count: 1, prompt_eval_count: 1 }) + '\n');
    });
  });
  return { server, seen };
}

test('a model whose template needs alternating roles is retried in that shape, once, then remembered', async () => {
  const { server, seen } = strictServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const client = new OllamaClient(() => `http://127.0.0.1:${port}`);
    const messages = [
      { role: 'system' as const, content: 'rules' },
      { role: 'assistant' as const, content: 'Welcome aboard.' },
      { role: 'user' as const, content: 'hi' },
    ];

    const first = await client.chat({ model: 'strict-model', messages, onToken: () => {} });
    assert.equal(first.content, 'Hi');
    assert.deepEqual(seen.map((s) => s.roles), ['sau', 'suau'], 'refused as sent, accepted with a user turn in front');

    seen.length = 0;
    await client.chat({ model: 'strict-model', messages });
    assert.deepEqual(seen.map((s) => s.roles), ['suau'], 'remembered: no wasted first request');

    seen.length = 0;
    await client.chat({ model: 'other-model', messages });
    assert.deepEqual(seen.map((s) => s.roles), ['sau'], 'a model that never refused is sent exactly what it always was');
  } finally {
    server.close();
  }
});

test('an HTTP error that is not about roles is not retried, and does not claim the server is unreachable', async () => {
  const { server, seen } = strictServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const client = new OllamaClient(() => `http://127.0.0.1:${port}`);
    await assert.rejects(
      client.chat({ model: 'broken', messages: [{ role: 'user', content: 'hi' }] }),
      (error: Error) => {
        assert.ok(error instanceof OllamaUnavailableError);
        assert.match(error.message, /rejected the request/);
        assert.doesNotMatch(error.message, /not reachable/);
        return true;
      }
    );
    assert.equal(seen.length, 1, 'no retry');
  } finally {
    server.close();
  }
});
