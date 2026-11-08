import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoods, serializeMoods, withMood } from './mood';

test('an unset, empty or unreadable column is no moods, never a throw', () => {
  assert.deepEqual(parseMoods(null), {});
  assert.deepEqual(parseMoods(''), {});
  assert.deepEqual(parseMoods('not json'), {});
  assert.deepEqual(parseMoods('[1,2]'), {});
  assert.deepEqual(parseMoods('"text"'), {});
});

test('only non-blank text moods survive reading, trimmed', () => {
  assert.deepEqual(parseMoods('{"a":"  wary ","b":"   ","c":5,"d":null}'), { a: 'wary' });
});

test('setting one speaker leaves the others, and blank clears just that speaker', () => {
  const start = { a: 'wary', b: 'giddy' };
  assert.deepEqual(withMood(start, 'a', '  furious '), { a: 'furious', b: 'giddy' });
  assert.deepEqual(withMood(start, 'a', '   '), { b: 'giddy' });
  assert.deepEqual(withMood(start, 'a', null), { b: 'giddy' });
  assert.deepEqual(start, { a: 'wary', b: 'giddy' }, 'the input is not mutated');
});

test('nobody having a mood stores NULL, and what is stored reads back', () => {
  assert.equal(serializeMoods({}), null);
  assert.deepEqual(parseMoods(serializeMoods({ a: 'wary' })), { a: 'wary' });
});
