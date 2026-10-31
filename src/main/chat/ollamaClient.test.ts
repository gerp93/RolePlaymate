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

test('chatWithTools sends the tools and window, streams text, and collects tool calls', async () => {
  let received: { tools?: unknown[]; options?: { num_ctx?: number }; stream?: boolean } = {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received = JSON.parse(body);
      res.write(JSON.stringify({ message: { role: 'assistant', content: 'Looking ' }, done: false }) + '\n');
      res.write(
        JSON.stringify({
          message: {
            role: 'assistant',
            content: '',
            // One call with object arguments (what Ollama sends), one with a JSON string (what some models do).
            tool_calls: [
              { function: { name: 'read_character', arguments: { name: 'Ada' } } },
              { function: { name: 'search_library', arguments: '{"query":"harbour"}' } },
            ],
          },
          done: false,
        }) + '\n'
      );
      res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 7, eval_count: 3 }) + '\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const client = new OllamaClient(() => `http://127.0.0.1:${port}`, () => 8192);
    const tokens: string[] = [];
    const result = await client.chatWithTools({
      model: 'm',
      messages: [{ role: 'user', content: 'who is Ada?' }],
      tools: [{ type: 'function', function: { name: 'read_character', description: 'd', parameters: { type: 'object' } } }],
      options: { num_ctx: 20000 },
      onToken: (t) => tokens.push(t),
    });
    assert.equal(received.tools?.length, 1);
    assert.equal(received.options?.num_ctx, 20000, 'the assistant window beats the roleplay chat window');
    assert.equal(received.stream, true);
    assert.equal(result.content, 'Looking ');
    assert.deepEqual(tokens, ['Looking ']);
    assert.deepEqual(
      result.toolCalls.map((c) => [c.function.name, c.function.arguments]),
      [
        ['read_character', { name: 'Ada' }],
        ['search_library', { query: 'harbour' }],
      ]
    );
    assert.equal(result.evalCount, 3);
  } finally {
    server.close();
  }
});

test('chatWithTools falls back to the roleplay window when the caller sets none', async () => {
  let numCtx: number | undefined;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      numCtx = JSON.parse(body).options.num_ctx;
      res.end(JSON.stringify({ message: { content: 'ok' }, done: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const client = new OllamaClient(() => `http://127.0.0.1:${port}`, () => 6000);
    const result = await client.chatWithTools({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    assert.equal(numCtx, 6000);
    assert.equal(result.content, 'ok');
    assert.deepEqual(result.toolCalls, []);
  } finally {
    server.close();
  }
});
