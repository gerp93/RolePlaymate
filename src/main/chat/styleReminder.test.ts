import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuationCue, buildStyleReminder, describeChain } from './styleReminder';

const base = { charName: 'Mara', personaName: 'Tom', concise: false, pov: null } as const;

test('the reminder quotes habits the character has fallen into, at the end of the prompt', () => {
  const text = buildStyleReminder({
    ...base,
    avoid: { phrases: ['heart pounding in my chest'], openings: ['i nod slowly'] },
  });
  assert.match(text, /Variety:/);
  assert.match(text, /"heart pounding in my chest"/);
  assert.match(text, /"i nod slowly\.\.\."/);
});

test('with nothing overused the reminder has no variety line', () => {
  assert.doesNotMatch(buildStyleReminder(base), /Variety:/);
  assert.doesNotMatch(buildStyleReminder({ ...base, avoid: { phrases: [], openings: [] } }), /Variety:/);
});

const reply = (content: string) => ({ role: 'assistant', content });

test('a continuation quotes where the last reply stopped and says to start after it', () => {
  const cue = buildContinuationCue('Mara', 'Tom', [
    { role: 'user', content: 'hi' },
    reply('*I look over the controls.* "Alright, here goes nothing," *I mutter, gripping the stick.*'),
  ]);
  assert.match(cue, /The last reply stopped at: "I look over the controls\. 'Alright, here goes nothing,' I mutter, gripping the stick\."/);
  assert.match(cue, /Start AFTER that moment/);
  assert.doesNotMatch(cue, /\*/, 'markdown is stripped from the quote');
  assert.doesNotMatch(cue, /turns in a row/, 'two replies are not yet a loop');
});

test('a long run of continuations is told the scene has to visibly change', () => {
  const run = [reply('One.'), reply('Two.'), reply('Three.')];
  const cue = buildContinuationCue('Mara', 'Tom', run);
  assert.match(cue, /taken 3 turns in a row/);
  assert.match(cue, /visibly change/);
});

test('with no earlier reply the cue is the plain note', () => {
  const cue = buildContinuationCue('Mara', 'Tom');
  assert.doesNotMatch(cue, /stopped at/);
  assert.match(cue, /Tom has not replied/);
});

test('the chain counts only replies after the last user message', () => {
  assert.equal(describeChain([reply('a'), { role: 'user', content: 'b' }]).chain, 0);
  assert.equal(describeChain([{ role: 'user', content: 'b' }, reply('a'), reply('c')]).chain, 2);
  assert.equal(describeChain([]).chain, 0);
});

test('a very long last reply is quoted by its final sentences only', () => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} goes here.`).join(' ');
  const { lastBeat } = describeChain([reply(long)]);
  assert.ok(lastBeat.length <= 260);
  assert.ok(lastBeat.endsWith('Sentence number 29 goes here.'));
  assert.ok(!lastBeat.includes('Sentence number 0 '));
});

test('the reminder says whose "I" is whose, and not to echo the persona', () => {
  const text = buildStyleReminder({ ...base, pov: 'first' });
  assert.match(text, /Who is who: you are Mara, and only Mara\./);
  assert.match(text, /"I" or "my" in a message from Tom means Tom, not you/);
  assert.match(text, /Do not retell or repeat Tom's action/);
});
