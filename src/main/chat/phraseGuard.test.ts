import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STALL_NOVELTY,
  describeOverused,
  findOverusedPhrases,
  hasOverused,
  isStalled,
  noveltyOf,
  plainWords,
} from './phraseGuard';

const replies = [
  '*I nod slowly, my heart pounding in my chest as we follow the corridor.* **"We should check the left door,"** *I whisper.*',
  '*My heart races. I take a breath, my heart pounding in my chest.* **"Wait, someone is coming,"** *I whisper.*',
  '*I nod slowly, the lantern swaying, my heart pounding in my chest.* **"That sound again,"** *I whisper.*',
  '*I study the map by lantern light.* **"The river route is shorter,"** *I say, tracing the line.*',
  '*I nod slowly, my heart pounding in my chest at the thought.* **"Then we go now,"** *I say.*',
];

test('plainWords drops formatting and keeps contractions', () => {
  assert.deepEqual(plainWords('*I can’t** wait,* **"Go!"**'), ['i', "can't", 'wait', 'go']);
});

test('a stock phrase used across several replies is found, once, in its fullest form', () => {
  const found = findOverusedPhrases(replies);
  assert.ok(found.phrases.some((p) => p.includes('heart pounding in my chest')), found.phrases.join(' | '));
  // Not reported twice as overlapping fragments of itself.
  assert.equal(found.phrases.filter((p) => p.includes('heart pounding')).length, 1);
});

test('an opening several replies share is found', () => {
  const found = findOverusedPhrases(replies);
  assert.ok(found.openings.includes('i nod slowly'));
});

test('varied replies, and phrases below the threshold, report nothing', () => {
  const varied = [
    '*The lamp flickers.* **"Do you hear that?"**',
    '*Rain hammers the skylight overhead.* **"We have until dawn."**',
    '*A door slams somewhere below.* **"Quiet. Listen."**',
    '*She unfolds the ledger carefully.* **"Here: the third entry is forged."**',
  ];
  const found = findOverusedPhrases(varied);
  assert.deepEqual(found, { phrases: [], openings: [] });
  assert.equal(hasOverused(found), false);
  assert.equal(describeOverused(found), '');
  // Two uses is a coincidence, not a habit.
  assert.deepEqual(findOverusedPhrases(replies.slice(0, 2)).phrases, []);
});

test('only the most recent replies count', () => {
  const old = Array.from({ length: 6 }, () => '*I gaze at the distant mountains, deep in thought.*');
  const fresh = [
    '*The kettle whistles.* **"Tea first, then maps."**',
    '*Gulls wheel above the quay.* **"Smell that salt?"**',
    '*A clock chimes eleven.* **"Late already."**',
    '*Paper rustles in the draft.* **"Close the window."**',
    '*Boots scrape the stairs.* **"Someone is coming up."**',
    '*Ink pools on the blotter.* **"Careful with that ledger."**',
    '*Thunder rolls over the roofs.* **"Storm by midnight."**',
    '*A candle gutters out.* **"Pass the matches."**',
    '*The ferry horn sounds twice.* **"That is our signal."**',
    '*Chalk dust hangs in the air.* **"Check the blackboard."**',
    '*Her coat drips on the tiles.* **"Where is the key?"**',
    '*Rust flakes off the railing.* **"Mind the third step."**',
  ];
  assert.deepEqual(findOverusedPhrases([...old, ...fresh]).phrases, []);
});

test('describeOverused quotes the habits it found', () => {
  const text = describeOverused(findOverusedPhrases(replies));
  assert.match(text, /heart pounding in my chest/);
  assert.match(text, /i nod slowly/);
  assert.match(text, /Do not use them/);
});

test("a phrase the other speaker uses too is the scene's vocabulary, not a habit", () => {
  const mine = Array.from({ length: 4 }, (_, i) => `*I study the reactor core, again${i}, and its humming casing.*`);
  assert.ok(findOverusedPhrases(mine).phrases.some((p) => p.includes('reactor core')));
  const theirs = ['The reactor core is humming louder.', 'Check the reactor core readings.', 'Nothing else matters but the reactor core.'];
  const found = findOverusedPhrases(mine, {}, theirs).phrases;
  assert.ok(!found.includes('reactor core') && !found.includes('the reactor core'), found.join(' | '));
});

test('words that are only function words are never a stock phrase', () => {
  const same = Array.from({ length: 5 }, () => 'and then it was in the');
  assert.deepEqual(findOverusedPhrases(same).phrases, []);
});

const moving = [
  'The archive door opens onto a long corridor lined with filing cabinets.',
  'A clerk hurries past carrying ledgers, and mutters about the missing inventory.',
  'You find a forged receipt tucked inside a ledger labelled with last winter.',
  'Someone has scratched initials into the cabinet, matching the receipt stamp.',
  'The stamp leads toward the harbour office, closed since the strike began.',
  'A bell rings from the clock tower, and pigeons scatter across the plaza.',
  'The harbour office window is unlatched; inside, crates are stacked unusually high.',
  'Opening a crate reveals brass instruments wrapped in newspaper from another city.',
  'The newspaper date proves the shipment arrived after the supposed fire.',
  'Footsteps approach, so both of you slip behind the shelving to listen.',
];

const circling = [
  'I keep my gun trained on the stranger, eyes narrowing in the dim light.',
  'The stranger raises both hands, eyes wide, and says nothing in the dim light.',
  'I keep my gun trained on the stranger, my voice low as the light flickers.',
  'The stranger swallows hard, hands raised, staring at the gun in the dim light.',
  'I keep my gun steady on the stranger, voice low, eyes narrowing again.',
  'The stranger stays silent, hands raised, watching the gun in the flickering light.',
  'I keep my gun trained on the stranger, my voice low, eyes narrowing once more.',
  'The stranger shakes, hands raised, eyes on the gun in the dim flickering light.',
  'I keep my gun trained on the stranger, voice low and steady in the dim light.',
  'The stranger whimpers, hands raised, staring at the gun in the dim light.',
];

test('a scene that keeps bringing in new things is not stalled; one going in circles is', () => {
  assert.equal(isStalled(moving), false);
  assert.equal(isStalled(circling), true);
  assert.ok(noveltyOf(moving, 9) > noveltyOf(circling, 9));
  assert.ok(STALL_NOVELTY > 0 && STALL_NOVELTY < 0.5);
});

test('too little conversation to judge is never a stall', () => {
  assert.equal(isStalled(circling.slice(0, 5)), false);
  assert.equal(isStalled([]), false);
});
