import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutOffOtherSpeakers, otherSpeakerNames, trimToCompleteSentence } from './suggestReply';

test('a draft that goes on to write the other speaker is cut at their label', () => {
  const draft =
    '*I look at Ethan, my expression serious.* "Tell us everything," *I say firmly.*\n\nVeridia: *I take a breath and answer.*';
  assert.equal(
    cutOffOtherSpeakers(draft, ['Veridia']),
    '*I look at Ethan, my expression serious.* "Tell us everything," *I say firmly.*'
  );
});

test('a dangling label at the very end is removed, so the trimmer is not left a stray "Veridia: *"', () => {
  const draft = '*I keep my gun at the ready.* "Tell us everything." *I say firmly.*\n\nVeridia: *';
  const cut = cutOffOtherSpeakers(draft, ['Veridia']);
  assert.equal(cut, '*I keep my gun at the ready.* "Tell us everything." *I say firmly.*');
  assert.equal(trimToCompleteSentence(cut), cut);
  // The same, on the line itself.
  assert.equal(cutOffOtherSpeakers('"Go on." Veridia: *', ['Veridia']), '"Go on."');
});

test('labels in bold or italics, any case, and several other speakers, are all caught', () => {
  assert.equal(cutOffOtherSpeakers('Fine, then.\n**Mara:** *shrugs*', ['Mara']), 'Fine, then.');
  assert.equal(cutOffOtherSpeakers('Fine, then.\nMARA : shrugs', ['Mara']), 'Fine, then.');
  assert.equal(cutOffOtherSpeakers('Fine.\nTom: ok\nMara: no', ['Mara', 'Tom']), 'Fine.');
});

test('a draft with no other speaker in it, or that merely mentions a name, is untouched', () => {
  const clean = '*I nod.* "Veridia, you were right about the door."';
  assert.equal(cutOffOtherSpeakers(clean, ['Veridia']), clean);
  // A draft that begins with the label is left alone rather than emptied.
  assert.equal(cutOffOtherSpeakers('Veridia: hello', ['Veridia']), 'Veridia: hello');
  // Names with regex characters do not break the match.
  assert.equal(cutOffOtherSpeakers('Ok.\nDr. (Q): hi', ['Dr. (Q)']), 'Ok.');
});

test('otherSpeakerNames lists the character and any group speakers, never the persona', () => {
  const names = otherSpeakerNames('Veridia', 'Cormac', [
    { role: 'user', content: 'x' },
    { role: 'assistant', content: 'y', speakerName: 'Ethan' },
    { role: 'assistant', content: 'z', speakerName: 'Cormac' },
  ]);
  assert.deepEqual(names.sort(), ['Ethan', 'Veridia']);
});

test('trimToCompleteSentence still cuts a capped draft back to its last sentence and closes markup', () => {
  assert.equal(trimToCompleteSentence('*I look up.* "Wait, there is something we should--'), '*I look up.*');
  assert.equal(trimToCompleteSentence('*I look up and see it. Then the lamp'), '*I look up and see it.*');
});
