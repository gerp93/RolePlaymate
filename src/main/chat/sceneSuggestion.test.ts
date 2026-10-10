import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneCheckPrompt, parseSceneSuggestion, SCENE_CHECK_EVERY } from './sceneSuggestion';
import { buildStyleReminder } from './styleReminder';

const lines = [
  { speaker: 'Mara', content: 'We reach the harbor as the sun comes up.' },
  { speaker: 'Tom', content: 'Then the ferry is our way out.' },
];

test('the check prompt shows the current note and the latest lines, and says how to answer', () => {
  const prompt = buildSceneCheckPrompt('In the tunnels under the city.', lines);
  assert.match(prompt, /Current scene note: In the tunnels under the city\./);
  assert.match(prompt, /Mara: We reach the harbor/);
  assert.match(prompt, /Tom: Then the ferry/);
  assert.match(prompt, /exactly: SAME/);
});

test('with no note yet the prompt asks for a description instead of a change', () => {
  const prompt = buildSceneCheckPrompt(null, lines);
  assert.match(prompt, /\(none yet\)/);
  assert.match(prompt, /Describe the scene as it is now/);
  assert.doesNotMatch(prompt, /exactly: SAME/);
});

test('SAME, or nothing, means no suggestion', () => {
  assert.equal(parseSceneSuggestion('SAME', 'In the tunnels.', null), null);
  assert.equal(parseSceneSuggestion('  same.\nbecause nothing changed', 'In the tunnels.', null), null);
  assert.equal(parseSceneSuggestion('', null, null), null);
  assert.equal(parseSceneSuggestion('ok', null, null), null, 'too short to be a scene');
});

test('a sentence is returned clean: label, bullet and quotes removed', () => {
  assert.equal(
    parseSceneSuggestion('Scene: "At the harbor at dawn, waiting for the ferry."', 'In the tunnels.', null),
    'At the harbor at dawn, waiting for the ferry.'
  );
  assert.equal(
    parseSceneSuggestion('- At the harbor at dawn.\nThis is because they left the tunnels.', 'In the tunnels.', null),
    'At the harbor at dawn.'
  );
});

test('a rephrasing of the current note, or of what was already offered, is not offered', () => {
  const note = 'Hiding in the sandstone tunnels under the Prism Spire.';
  assert.equal(parseSceneSuggestion('They are hiding in the sandstone tunnels under the Prism Spire.', note, null), null);
  const offered = 'At the harbor at dawn, waiting for the ferry.';
  assert.equal(parseSceneSuggestion('Waiting for the ferry at the harbor at dawn.', note, offered), null);
  assert.notEqual(parseSceneSuggestion('Inside the records annex, searching the shelves.', note, offered), null);
});

test('an over-long answer is cut back to a complete sentence', () => {
  const long = `At the harbor at dawn. ${'They wait and watch the water and the gulls and the ferry. '.repeat(10)}`;
  const result = parseSceneSuggestion(long, null, null);
  assert.ok(result && result.length <= 300);
  assert.match(result!, /[.!?]$/);
});

test('a check runs on a fixed rhythm of replies', () => {
  assert.ok(Number.isInteger(SCENE_CHECK_EVERY) && SCENE_CHECK_EVERY >= 1);
});

test('the reminder carries the scene note, at the end of the prompt, only when there is one', () => {
  const base = { charName: 'Mara', personaName: 'Tom', concise: false, pov: null } as const;
  const withNote = buildStyleReminder({ ...base, sceneNote: 'At the harbor at dawn.' });
  assert.match(withNote, /Current scene \(in effect until the story moves on -- stay in it\): At the harbor at dawn\./);
  assert.doesNotMatch(buildStyleReminder(base), /Current scene/);
  assert.doesNotMatch(buildStyleReminder({ ...base, sceneNote: '   ' }), /Current scene/);
});
