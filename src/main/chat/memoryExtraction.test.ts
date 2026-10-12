import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRedundant, formatExchanges, parseExtractedFacts, pickPrunable, stripAnalyticTail, whyUnfit } from './memoryExtraction';

test('second-person "facts" are rejected: a memory is read back by someone else', () => {
  assert.equal(whyUnfit('The way you touch and kiss her shows your deep love and desire for her.'), 'second person');
  assert.equal(whyUnfit("You're the only one who knows about the key."), 'second person');
});

test('commentary on the scene is rejected', () => {
  for (const text of [
    'Your declaration to worship every inch of her body sets the stage for a sensual and intimate encounter.',
    'The intimate placement of her hand suggests a growing romantic subplot.',
    "Veridia's whisper highlights the emotional connection between the two.",
    'The kiss underscores their mutual attraction.',
    'The conversation marks a turning point in their relationship.',
  ]) {
    assert.notEqual(whyUnfit(text), null, text);
  }
});

test('feelings and impulses, which pass, are rejected', () => {
  for (const text of [
    'Veridia is nervous about the dark, foreboding nature of the tunnels.',
    'Veridia is compelled to get closer to the machine, despite the danger.',
    'Mara felt a wave of relief wash over her.',
    'Tom is clearly in a state of distress.',
  ]) {
    assert.equal(whyUnfit(text), 'feeling', text);
  }
});

test('facts that happened or were established are kept', () => {
  for (const text of [
    'The altered blueprints converge on the abandoned Riverstone District.',
    'She believes someone at the Bureau is watching her.',
    'She suggests they need to investigate the tunnels directly.',
    'Veridia sneaked the evidence folder out after her clearance was revoked.',
    'Cormac Kincaid handed Veridia his spare pistol before leaving to hold off the intruders.',
    'The ghost signature on the altered documents is J. Cobalt.',
    'Ethan says the machine woke the night the power failed.',
    'Mara twisted her ankle in the maintenance shaft.',
    'They agreed to meet at the clock tower at dawn.',
  ]) {
    assert.equal(whyUnfit(text), null, text);
  }
});

test('filterRedundant applies it along with the older filters', () => {
  const kept = filterRedundant(
    [
      'Mara hid the ledger inside the clock tower.',
      'Mara is nervous about being followed.',
      'Her trembling hand shows how much she trusts you.',
      'Mara hid the ledger inside the clock tower.',
    ],
    '',
    []
  );
  assert.deepEqual(kept, ['Mara hid the ledger inside the clock tower.']);
});

test('a bullet cut off by the token cap is dropped, as before', () => {
  assert.deepEqual(parseExtractedFacts('- Mara hid the ledger.\n- The key is under the'), ['Mara hid the ledger.']);
  assert.deepEqual(parseExtractedFacts('NONE'), []);
});

test('scene upkeep (what is going on right now) is rejected', () => {
  for (const text of [
    'The siren continues to blare in the background.',
    'The air is becoming hotter and more humid.',
    'The hum of the machine is growing louder.',
  ]) {
    assert.equal(whyUnfit(text), 'momentary', text);
  }
});

test('an explanatory tail is cut off a fact, leaving the event', () => {
  assert.equal(
    stripAnalyticTail('She hears gunshots and his voice behind her, indicating that he is fighting the intruders.'),
    'She hears gunshots and his voice behind her.'
  );
  assert.equal(stripAnalyticTail('Tom arranges a private ambulance, showing his concern for Mara.'), 'Tom arranges a private ambulance.');
  // No tail: unchanged. Nothing left but a tail: unchanged (the filters decide).
  assert.equal(stripAnalyticTail('The blueprints converge on the old district.'), 'The blueprints converge on the old district.');
  assert.equal(stripAnalyticTail('Showing the way.'), 'Showing the way.');
  // Applied by the filter, so the event is kept.
  assert.deepEqual(filterRedundant(['Tom arranges a private ambulance, showing his concern for Mara.'], '', []), ['Tom arranges a private ambulance.']);
});

test('what someone is doing at the moment, and scenery, are never kept, whatever the verb', () => {
  for (const text of [
    'Vespara is exploring the cockpit and control panel, trying to find information about their location.',
    'She is expressing her frustration and confusion about being left alone without any information.',
    'She is feeling trapped and powerless in her current situation.',
    'She is yanking the controls forward to send the ship into motion',
    'The ship is lurching into motion, its engines humming around Vespara',
    'She is muttering "Fuck it" and grinning recklessly',
    'The ship is a sleek, advanced model with cutting-edge technology',
    'Vespara noticed the ship is more advanced than most freighters, with a sleek design.',
  ]) {
    assert.notEqual(whyUnfit(text), null, text);
  }
});

test('real facts still pass, including ones with a progressive later in the sentence', () => {
  for (const text of [
    'Corso locked Vespara in the cargo bay and left with the access codes.',
    'She believes someone at the Bureau is watching her.',
    'Vespara learned the freighter is registered under a false name.',
  ]) {
    assert.equal(whyUnfit(text), null, text);
  }
});

test('the exchanges an extraction reads are laid out as a transcript, a continue having no user line', () => {
  assert.equal(
    formatExchanges([
      { userMessage: 'Hi', aiResponse: 'Hello.' },
      { userMessage: '', aiResponse: 'More.' },
    ]),
    'User: Hi\nAssistant: Hello.\n\nAssistant: More.'
  );
});

test('clean-up removes junk and paraphrases of an earlier memory, never a pinned one', () => {
  const v = (x: number, y: number) => [x, y];
  const prune = pickPrunable([
    { id: 'a', content: 'Corso locked Vespara in the cargo bay.', source: 'auto', vector: v(1, 0) },
    { id: 'b', content: 'She is running her fingers along the switches.', source: 'auto', vector: v(0, 1) },
    { id: 'c', content: 'Vespara was shut in the cargo hold by Corso.', source: 'auto', vector: v(0.99, 0.05) },
    { id: 'd', content: 'She is running her fingers along the switches.', source: 'manual', vector: v(0, 1) },
    { id: 'e', content: 'The access codes are in the captain\'s safe.', source: 'auto', vector: null },
  ]);
  assert.deepEqual(prune, ['b', 'c']);
});
