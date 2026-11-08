import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuationCue, buildStyleReminder } from './styleReminder';

const base = { charName: 'Mara', personaName: 'Tom', concise: false, pov: null } as const;

test('the reminder is the plain formatting guidance, with nothing extra about habits or identity', () => {
  const text = buildStyleReminder(base);
  assert.match(text, /Formatting:/);
  assert.doesNotMatch(text, /Variety:/);
  assert.doesNotMatch(text, /Who is who/);
});

test('directions, the scene note and the memory-continuity rule appear only when there is something to say', () => {
  const plain = buildStyleReminder(base);
  assert.doesNotMatch(plain, /Direction for this reply/);
  assert.doesNotMatch(plain, /Current scene/);
  assert.doesNotMatch(plain, /Scene continuity/);

  const full = buildStyleReminder({ ...base, directions: 'Be brief.', sceneNote: 'On the bridge.', hasMemories: true });
  assert.match(full, /Direction for this reply.*Be brief\./);
  assert.match(full, /Current scene.*On the bridge\./);
  assert.match(full, /Scene continuity/);
});

test('a mood appears only when set, names the speaker, and is framed as holding until changed', () => {
  assert.doesNotMatch(buildStyleReminder(base), /mood/i);
  assert.doesNotMatch(buildStyleReminder({ ...base, mood: '   ' }), /mood/i);
  assert.doesNotMatch(buildStyleReminder({ ...base, mood: null }), /mood/i);

  const text = buildStyleReminder({ ...base, mood: ' guarded and a little hurt ' });
  assert.match(text, /Mara's current mood \(set by the user; it holds until they change it\): guarded and a little hurt\./);
  // It colors the personality rather than replacing it.
  assert.match(text, /staying true to Mara's personality/);
});

test('a redo made for overused wording names what was reused', () => {
  const text = buildStyleReminder({ ...base, retryAvoid: ['heart pounding'] });
  assert.match(text, /"heart pounding"/);
});

test('the continuation note is the plain one: it asks for something new and never writes for the persona', () => {
  const cue = buildContinuationCue('Mara', 'Tom');
  assert.match(cue, /Tom has not replied\. Continue the scene as Mara/);
  assert.match(cue, /something NEW/);
  assert.doesNotMatch(cue, /stopped at/);
});
