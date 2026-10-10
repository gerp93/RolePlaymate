import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStyleReminder } from './styleReminder';

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
