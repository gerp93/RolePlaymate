import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { DEFAULT_CONTEXT_WINDOW, estimateTokens, fitMessagesToContext } from './contextBudget';
import { OllamaClient } from './ollamaClient';
import type { OllamaChatMessage } from './ollamaClient';

const text = (words: number) => 'word '.repeat(words).trim();
const S = (content: string): OllamaChatMessage => ({ role: 'system', content });
const U = (content: string): OllamaChatMessage => ({ role: 'user', content });
const A = (content: string): OllamaChatMessage => ({ role: 'assistant', content });
const roles = (messages: OllamaChatMessage[]) => messages.map((m) => m.role[0]).join('');

/** system, then n user/assistant pairs, then a final user turn -- each message about `words` words. */
function conversation(pairs: number, words = 200): OllamaChatMessage[] {
  const out: OllamaChatMessage[] = [S('rules')];
  for (let i = 0; i < pairs; i += 1) out.push(U(`${i} ${text(words)}`), A(`${i} ${text(words)}`));
  out.push(U('and now?'));
  return out;
}

test('a conversation that fits is sent exactly as it is', () => {
  const messages = conversation(3, 50);
  const fitted = fitMessagesToContext(messages, 8192, 300);
  assert.equal(fitted.dropped, 0);
  assert.equal(fitted.messages, messages, 'the very same array, untouched');
});

test('one that does not fit loses its oldest turns, and keeps the system message and the latest turns', () => {
  const messages = conversation(24, 200); // roughly 10,000 tokens
  const fitted = fitMessagesToContext(messages, 4096, 320);
  assert.ok(fitted.dropped > 0);
  assert.equal(fitted.messages[0].role, 'system');
  assert.equal(fitted.messages.at(-1)?.content, 'and now?');
  assert.ok(fitted.messages.at(-2)?.content.startsWith('23 '), 'the reply the last line answers is kept');
  const total = fitted.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  assert.ok(total <= 4096 - 320, `fits the window: ${total}`);
});

test('the cut never leaves the conversation opening on the assistant, so a strict template still accepts it', () => {
  for (const pairs of [3, 8, 14, 24]) {
    for (const window of [2048, 3000, 4096, 6000]) {
      const fitted = fitMessagesToContext(conversation(pairs), window, 300).messages;
      const rest = fitted.filter((m) => m.role !== 'system');
      assert.ok(rest.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant')), `${pairs} pairs, window ${window}: ${roles(fitted)}`);
    }
  }
});

test('the latest user turn is kept however small the window, and a system message too big alone is left to the server', () => {
  const tiny = fitMessagesToContext(conversation(5, 400), 1000, 300);
  assert.equal(tiny.messages.at(-1)?.content, 'and now?');
  assert.deepEqual(tiny.messages.map((m) => m.role), ['system', 'user'], 'opens on the user, as a strict template needs');
  const hugeSystem = fitMessagesToContext([S(text(20000)), U('hi')], 2048, 300);
  assert.equal(hugeSystem.dropped, 0);
});

// ---- the client asks for the window ---------------------------------------------------------------

function recordingServer() {
  const seen: { options: Record<string, unknown>; messages: { role: string }[] }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = JSON.parse(body) as { options: Record<string, unknown>; messages: { role: string }[] };
      seen.push({ options: parsed.options, messages: parsed.messages });
      res.end(JSON.stringify({ message: { content: 'Hi' }, done: true, eval_count: 1, prompt_eval_count: 1 }));
    });
  });
  return { server, seen };
}

test('every chat request asks for the context window, read fresh each time, unless the caller chose one', async () => {
  const { server, seen } = recordingServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    let window = DEFAULT_CONTEXT_WINDOW;
    const client = new OllamaClient(() => `http://127.0.0.1:${port}`, () => window);
    const messages = [S('rules'), U('hi')];

    await client.chat({ model: 'm', messages });
    window = 16384;
    await client.chat({ model: 'm', messages, options: { temperature: 0.5 } });
    await client.chat({ model: 'm', messages, options: { num_ctx: 2048 } });

    assert.deepEqual(seen.map((s) => s.options.num_ctx), [DEFAULT_CONTEXT_WINDOW, 16384, 2048]);
    assert.equal(seen[1].options.temperature, 0.5, 'the caller\'s other options are kept');
  } finally {
    server.close();
  }
});

test('a conversation too long for the window is cut in whole turns before it is sent, and the result says so', async () => {
  const { server, seen } = recordingServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const client = new OllamaClient(() => `http://127.0.0.1:${port}`, () => 4096);
    const long = conversation(24, 200);
    const result = await client.chat({ model: 'm', messages: long, options: { num_predict: 320 } });
    assert.ok(result.contextDropped > 0);
    assert.ok(seen[0].messages.length < long.length);
    const rest = seen[0].messages.filter((m) => m.role !== 'system');
    assert.equal(rest[0].role, 'user', 'a strict template would accept what was sent');

    const short = await client.chat({ model: 'm', messages: [S('rules'), U('hi')] });
    assert.equal(short.contextDropped, 0);
  } finally {
    server.close();
  }
});
