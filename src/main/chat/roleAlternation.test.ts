import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_PLACEHOLDER, alternateRoles, isAlternationError } from './roleAlternation';
import type { OllamaChatMessage } from './ollamaClient';

const S = (content: string): OllamaChatMessage => ({ role: 'system', content });
const U = (content: string): OllamaChatMessage => ({ role: 'user', content });
const A = (content: string): OllamaChatMessage => ({ role: 'assistant', content });
const shape = (messages: OllamaChatMessage[]) => messages.map((m) => m.role[0]).join('');

test('a conversation that opens with the greeting gets a user turn in front of it', () => {
  const out = alternateRoles([S('rules'), A('Welcome aboard.'), U('hi')]);
  assert.equal(shape(out), 'suau');
  assert.deepEqual(out[1], { role: 'user', content: OPENING_PLACEHOLDER });
  assert.equal(out[2].content, 'Welcome aboard.');
});

test('lines from the same side back to back are joined in order', () => {
  const out = alternateRoles([S('rules'), U('one'), U('two'), A('reply'), A('more'), U('last')]);
  assert.equal(shape(out), 'suau');
  assert.equal(out[1].content, 'one\n\ntwo');
  assert.equal(out[2].content, 'reply\n\nmore');
});

test('a conversation that already alternates, from the user, is unchanged', () => {
  const messages = [S('rules'), U('a'), A('b'), U('c')];
  assert.deepEqual(alternateRoles(messages), messages);
});

test('no system message, an empty list, and several system messages are all handled', () => {
  assert.equal(shape(alternateRoles([A('greeting'), U('hi')])), 'uau');
  assert.deepEqual(alternateRoles([]), []);
  const merged = alternateRoles([S('one'), S('two'), U('hi')]);
  assert.equal(shape(merged), 'su');
  assert.equal(merged[0].content, 'one\n\ntwo');
});

test('the input is not modified', () => {
  const input = [S('rules'), A('Welcome aboard.'), U('hi'), U('again')];
  const copy = JSON.parse(JSON.stringify(input));
  alternateRoles(input);
  assert.deepEqual(input, copy);
});

test('Ollama\'s refusal is recognised by its wording', () => {
  assert.equal(
    isAlternationError('HTTP 400 {"error":"After the optional system message, conversation roles must alternate user/assistant/..."}'),
    true
  );
  assert.equal(isAlternationError('HTTP 500 model failed to load'), false);
});
