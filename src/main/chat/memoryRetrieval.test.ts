import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryQuery, selectMemories } from './memoryRetrieval';
import type { ScoredMemory } from '../../shared/types/conversationMemory';

let counter = 0;
function mem(id: string, score: number, opts: { day?: number; pinned?: boolean; text?: string } = {}): ScoredMemory {
  counter += 1;
  const day = String(opts.day ?? counter).padStart(2, '0');
  return {
    memory: {
      id,
      conversationId: 'c',
      content: opts.text ?? `Fact ${id}.`,
      source: opts.pinned ? 'manual' : 'auto',
      messageId: null,
      createdAt: `2026-01-${day}T00:00:00Z`,
    },
    score,
    pinned: !!opts.pinned,
  };
}

const ids = (r: { selected: ScoredMemory[] }) => r.selected.map((s) => s.memory.id);

test('pinned memories are always in, whatever their score or the budget', () => {
  const result = selectMemories('q', [mem('p', 0.01, { pinned: true, text: 'x'.repeat(4000) }), mem('a', 0.9)], { topK: 3, tokenBudget: 50 });
  assert.ok(ids(result).includes('p'));
  assert.ok(ids(result).includes('a') === false, 'the pinned one used the whole budget');
});

test('memories under the minimum score, and over the budget, are left out', () => {
  const result = selectMemories(
    'q',
    [mem('low', 0.1), mem('ok', 0.6), mem('big', 0.7, { text: 'y'.repeat(4000) })],
    { topK: 5, minScore: 0.25, tokenBudget: 100 }
  );
  assert.deepEqual(ids(result), ['ok']);
  assert.deepEqual(
    result.rejected.map((r) => r.memory.id).sort(),
    ['big', 'low']
  );
});

test('the founding memories keep some slots even when recent ones match the scene better', () => {
  // Thirty memories about the scene as it is now, which match strongly; the story's founding facts, which
  // match less; and some from the early scene, which match least (the story has moved on from it).
  const recent = Array.from({ length: 30 }, (_, i) => mem(`recent${i}`, 0.72 - i * 0.004, { day: 20 + i }));
  const early = Array.from({ length: 6 }, (_, i) => mem(`early${i}`, 0.4 + i * 0.01, { day: 3 + i }));
  const founding = [mem('premise1', 0.5, { day: 1 }), mem('premise2', 0.48, { day: 2 })];
  const result = selectMemories('q', [...recent, ...early, ...founding], { topK: 6, minScore: 0.25, tokenBudget: 10_000 });
  assert.equal(result.selected.length, 6);
  assert.ok(ids(result).includes('premise1') && ids(result).includes('premise2'), ids(result).join(','));
  // By score alone neither would have got in.
  const byScoreOnly = [...recent, ...early, ...founding].sort((a, b) => b.score - a.score).slice(0, 6).map((s) => s.memory.id);
  assert.ok(!byScoreOnly.includes('premise1'));
});

test('a memory injected in many recent turns is passed over for another', () => {
  const stale = mem('stale', 0.8, { day: 10 });
  const others = Array.from({ length: 8 }, (_, i) => mem(`o${i}`, 0.75 - i * 0.01, { day: 11 + i }));
  const fresh = selectMemories('q', [stale, ...others], { topK: 4, tokenBudget: 10_000 });
  assert.ok(ids(fresh).includes('stale'));
  const used = selectMemories('q', [stale, ...others], { topK: 4, tokenBudget: 10_000 }, { recentUses: new Map([['stale', 8]]) });
  assert.ok(!ids(used).includes('stale'), ids(used).join(','));
});

test('near-copies of one moment do not fill every slot', () => {
  const unit = (x: number, y: number) => {
    const n = Math.hypot(x, y);
    return [x / n, y / n];
  };
  // Three memories about the same thing (identical direction) and one about something else.
  const a = mem('a1', 0.74, { day: 20 });
  const b = mem('a2', 0.73, { day: 21 });
  const c = mem('a3', 0.72, { day: 22 });
  const d = mem('other', 0.66, { day: 23 });
  const vectors = new Map<string, number[]>([
    ['a1', unit(1, 0)],
    ['a2', unit(1, 0.01)],
    ['a3', unit(1, 0.02)],
    ['other', unit(0, 1)],
  ]);
  // Only the top three are wanted: without variety they would be the three near-copies.
  const plain = selectMemories('q', [a, b, c, d], { topK: 3, tokenBudget: 10_000 });
  assert.deepEqual(ids(plain).sort(), ['a1', 'a2', 'a3']);
  const varied = selectMemories('q', [a, b, c, d], { topK: 3, tokenBudget: 10_000 }, { vectors });
  assert.ok(ids(varied).includes('other'), ids(varied).join(','));
});

test('with few memories the held slots do not leave a slot empty or take anything under the minimum', () => {
  const result = selectMemories('q', [mem('only', 0.9, { day: 5 })], { topK: 6 });
  assert.deepEqual(ids(result), ['only']);
  assert.equal(selectMemories('q', [], {}).selected.length, 0);
});

test('the retrieval query is the recent scene, markup stripped, newest last', () => {
  const q = buildMemoryQuery([{ content: '*waves*' }, { content: 'Hello there' }], 'Yes.');
  assert.equal(q, 'waves\nHello there\nYes.');
});
