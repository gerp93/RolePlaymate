import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOverusedPhrases, overusedHits, repeatedSequenceShare } from './phraseGuard';
import { whyUnfit } from './memoryExtraction';
import { RECENT_USE_LIMIT, selectMemories } from './memoryRetrieval';
import { buildStyleReminder } from './styleReminder';
import type { ScoredMemory } from '../../shared/types/conversationMemory';

// ---- overusedHits: did a finished reply fall back on the flagged habits anyway --------------------

const habit = { phrases: ['take a deep breath', 'heart pounding in my chest'], openings: ['i step forward'] };

test('a reply that uses a flagged phrase, in any case or with formatting around it, is a hit', () => {
  assert.deepEqual(overusedHits('*I Take a DEEP breath,* and wait.', habit), ['take a deep breath']);
  assert.deepEqual(
    overusedHits('**"Now,"** I say, my heart pounding in my chest as the door opens.', habit),
    ['heart pounding in my chest']
  );
});

test('a flagged opening is a hit only at the very start of the reply', () => {
  assert.deepEqual(overusedHits('*I step forward, eyes on the door.*', habit), ['i step forward...']);
  assert.deepEqual(overusedHits('Then I step forward, eyes on the door.', habit), []);
});

test('a phrase that only resembles a flagged one, or nothing flagged at all, is not a hit', () => {
  assert.deepEqual(overusedHits('She breathes in deeply and counts to three.', habit), []);
  assert.deepEqual(overusedHits('anything at all', undefined), []);
  assert.deepEqual(overusedHits('anything at all', { phrases: [], openings: [] }), []);
});

test('overusedHits agrees with findOverusedPhrases about what is flagged', () => {
  const replies = [
    '*I take a deep breath, trying to calm my nerves.* The door is shut.',
    '*I take a deep breath, trying to calm my nerves.* The ledger is gone.',
    '*I take a deep breath, trying to calm my nerves.* The lamp flickers.',
  ];
  const found = findOverusedPhrases(replies);
  assert.ok(found.phrases.length > 0);
  assert.ok(overusedHits('Once more I take a deep breath, trying to calm my nerves.', found).length > 0);
  assert.deepEqual(overusedHits('The lamp flickers and goes out.', found), []);
});

// ---- repeatedSequenceShare: paraphrase loops that word-set overlap cannot see --------------------

const looped = [
  '*I step forward.* "Your corruption ends now before Haven\'s citizens who have suffered under your manipulation all these years. No more secrets or lies behind closed doors."',
  '*I step forward.* "Your corruption ends now before Haven\'s citizens who have suffered under your manipulation all these years," I say. "No more secrets or lies from behind closed doors."',
];

test('the same sentences in slightly new words share most of their five-word sequences', () => {
  const share = repeatedSequenceShare(looped[1], [looped[0]]);
  assert.ok(share >= 0.4, `share was ${share}`);
});

test('a genuinely new reply on the same scene shares almost none', () => {
  const fresh = 'The records annex smells of damp paper. Veridia crouches by a low drawer and slides it open, finding a ledger whose spine has been scrubbed pale with solvent.';
  assert.ok(repeatedSequenceShare(fresh, looped) < 0.1);
});

test('too little text to compare, or nothing to compare against, is no repeat', () => {
  assert.equal(repeatedSequenceShare('Yes.', looped), 0);
  assert.equal(repeatedSequenceShare(looped[0], []), 0);
});

// ---- memory hygiene -------------------------------------------------------------------------------

test('what someone is in the middle of doing is not a memory; a fact with the same verb later in the sentence is', () => {
  assert.equal(whyUnfit('Cormac Kincaid is taking a closer look at the evidence Veridia brought him.'), 'momentary');
  assert.equal(whyUnfit('Veridia is preparing to share more details about her organization.'), 'momentary');
  assert.equal(whyUnfit('Veridia and Cormac are hiding behind a stack of crates.'), 'momentary');
  assert.equal(whyUnfit('She believes someone at the Bureau is watching her.'), null);
  assert.equal(whyUnfit('Cormac examined the evidence and found a scrubbed serial number.'), null);
});

test('the model reading a mood off the scene is commentary', () => {
  assert.equal(whyUnfit("Veridia's fear and urgency are evident in her demeanor as she shares these details."), 'commentary');
  assert.equal(whyUnfit('Her body language shows she is hiding something.'), 'commentary');
});

let n = 0;
const mem = (id: string, score: number): ScoredMemory => {
  n += 1;
  return {
    memory: {
      id,
      conversationId: 'c',
      content: `Fact ${id}.`,
      source: 'auto',
      messageId: null,
      createdAt: `2026-02-${String(n).padStart(2, '0')}T00:00:00Z`,
    },
    score,
    pinned: false,
  };
};

test('a memory injected in too many recent turns is left out, even an old one that matches everything', () => {
  const uses = new Map([['founding', RECENT_USE_LIMIT], ['other', 1]]);
  const result = selectMemories('q', [mem('founding', 0.95), mem('other', 0.5), mem('fresh', 0.4)], { topK: 3 }, { recentUses: uses });
  const chosen = result.selected.map((s) => s.memory.id);
  assert.ok(!chosen.includes('founding'));
  assert.ok(chosen.includes('other') && chosen.includes('fresh'));
  assert.ok(result.rejected.some((r) => r.memory.id === 'founding'), 'it is reported as left out');
});

test('one use fewer than the limit is still allowed', () => {
  const uses = new Map([['founding', RECENT_USE_LIMIT - 1]]);
  const result = selectMemories('q', [mem('founding', 0.95), mem('x', 0.4)], { topK: 3 }, { recentUses: uses });
  assert.ok(result.selected.some((s) => s.memory.id === 'founding'));
});

// ---- the redo reminder ------------------------------------------------------------------------------

test('a redo made for overused wording says what it reused; an ordinary reminder does not', () => {
  const base = { charName: 'Mara', personaName: 'Tom', concise: false, pov: null } as const;
  const text = buildStyleReminder({ ...base, retryAvoid: ['take a deep breath', 'i step forward...'] });
  assert.match(text, /previous attempt at this reply reused wording/);
  assert.match(text, /"take a deep breath", "i step forward\.\.\."/);
  assert.doesNotMatch(buildStyleReminder(base), /previous attempt/);
  assert.doesNotMatch(buildStyleReminder({ ...base, retryAvoid: [] }), /previous attempt/);
});
