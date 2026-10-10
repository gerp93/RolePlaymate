import { OllamaClient } from './ollamaClient';
import {
  ConversationMemory,
  MemoryRetrievalResult,
  ScoredMemory,
} from '../../shared/types/conversationMemory';
import { DEFAULT_EMBEDDING_MODEL } from '../../shared/embeddingModel';

/**
 * Picks which of a conversation's stored memories to inject this turn.
 *
 * Ported from KVGenius's semantic_index.py, with the sentence-transformer replaced by
 * Ollama's embeddings endpoint. That removes the torch dependency *and* the documented
 * Blackwell/sm_120 SDPA workaround the original had to carry -- 318 lines of local
 * inference and GPU-specific patching become one HTTP call.
 *
 * Semantic rather than keyword matching (which is what lore uses) because extracted
 * memories are paraphrases with no fixed vocabulary: "she distrusts the dock authority"
 * should surface when the user asks about "the harbour officials", and no key list would
 * cover that.
 */

export interface MemoryRetrievalOptions {
  topK?: number;
  minScore?: number;
  tokenBudget?: number;
  embeddingModel?: string;
}

export const DEFAULT_MEMORY_OPTIONS: Required<Omit<MemoryRetrievalOptions, 'embeddingModel'>> & {
  embeddingModel: string;
} = {
  // Fewer than it used to be: memories compete with the live transcript for the model's
  // attention, and a long tail of weakly-related ones is what pulls a scene somewhere else.
  topK: 6,
  minScore: 0.25,
  tokenBudget: 400,
  embeddingModel: DEFAULT_EMBEDDING_MODEL,
};

/** How many recent lines (and how many characters of them) describe "the scene right now". */
const QUERY_RECENT_TURNS = 4;
const QUERY_MAX_CHARS = 1500;

/**
 * What retrieval embeds. The outgoing message alone is often a few words ("*nods*", "Yes."),
 * which says nothing about where the scene is -- so it matched whatever stored memory happened to
 * be vaguely similar, from any earlier scene. Folding in the last few lines ties the query to
 * the current setting, so memories about it outrank memories about somewhere the story left.
 * Newest text goes last and survives the cap.
 */
export function buildMemoryQuery(
  recentTurns: { content: string }[],
  currentMessage: string
): string {
  const lines = [...recentTurns.slice(-QUERY_RECENT_TURNS).map((turn) => turn.content), currentMessage]
    .map((line) => line.replace(/\*/g, '').trim())
    .filter(Boolean);
  return lines.join('\n').slice(-QUERY_MAX_CHARS);
}

/** Same ~4-chars-per-token estimate the lore budget uses. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

/** Scales a vector to unit length so a dot product is the cosine similarity. */
export function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  // A zero vector has no direction; returning it unchanged keeps every similarity at 0
  // rather than producing NaN and poisoning the whole ranking.
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

export function dot(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += a[i] * b[i];
  return total;
}

/** Cached embeddings are stored as raw float32 bytes. */
export function vectorToBlob(vector: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vector).buffer);
}

export function blobToVector(blob: Uint8Array): number[] {
  // The stored bytes may sit at an offset inside a larger buffer, so the view is built
  // from the exact byte range rather than the whole underlying ArrayBuffer.
  return Array.from(
    new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength))
  );
}

/** A memory plus whatever embedding is cached for it, and which model produced it. */
export interface MemoryWithEmbedding {
  memory: ConversationMemory;
  embedding: number[] | null;
  embeddingModel: string | null;
}

/** What `selectMemories` needs beyond the scores to choose well. All optional: without it, selection is
 * by score alone. */
export interface SelectionContext {
  /** For each memory, in how many of the last few turns it was injected. A memory that has been put in
   * front of the model turn after turn stops adding anything and becomes a rut. */
  recentUses?: ReadonlyMap<string, number>;
  /** Each memory's embedding (unit length), so the chosen ones can be told apart from each other. */
  vectors?: ReadonlyMap<string, number[]>;
}

/** Score taken off per recent use, up to RECENT_USE_CAP uses. Scores of the memories that make the cut
 * sit within a few hundredths of each other, so this is enough to rotate in another. */
const RECENT_USE_PENALTY = 0.025;
const RECENT_USE_CAP = 8;
/** A memory already injected in this many of the last turns is left out for now, whatever its score and
 * even if it is a founding memory: the score penalty above is too gentle to stop a fact that matches
 * everything (one sat in the prompt for 40 of 100 turns). It returns once it has dropped out of the window. */
export const RECENT_USE_LIMIT = 5;
/** Share of the slots held for the founding memories (rounded down), and which count as founding: the
 * oldest 15% of the store, at least 8 of them, but never more than the older half. */
const ANCHOR_SHARE = 1 / 3;
const ANCHOR_POOL_SHARE = 0.15;
const ANCHOR_POOL_MIN = 8;
/** Weight of relevance against difference from what is already chosen (1 = relevance only). */
const MMR_RELEVANCE = 0.75;

/**
 * Ranks and selects memories.
 *
 * What is kept from the source's selection loop:
 *
 *  1. Pinned ('manual') memories are always selected -- they bypass both the score
 *     threshold and the token budget, which the budget may go negative for. The user asked
 *     for them explicitly.
 *  2. Pinned memories still count toward `topK`, so a pile of manual memories can crowd out
 *     retrieved ones. That is a real bound on prompt bloat, not a bug.
 *  3. A candidate over the remaining budget is rejected but the walk continues, so a later,
 *     shorter memory can still fit.
 *
 * What changed, because ranking by similarity alone favours the scene happening right now:
 *
 *  - **Held slots for the founding memories.** The query is the last few lines, so it matches memories
 *    made a few lines ago and the founding facts of the story (who is after whom, what is at stake) lose to
 *    them on every turn and drop out of the prompt for good. A third of the slots go to the best-matching
 *    of the oldest memories, so the beginning stays in play.
 *  - **A cooldown.** A memory already injected in several recent turns is marked down, so one fact does
 *    not sit in the prompt for dozens of turns and get echoed back (a stale mood memory was injected in
 *    38 of 100 turns in one run, and its wording turned up in the replies).
 *  - **Variety.** The rest of the slots are filled one at a time, each chosen for relevance but also for
 *    being unlike the memories already chosen, instead of the top few near-copies of one moment.
 */
export function selectMemories(
  query: string,
  scored: ScoredMemory[],
  options: MemoryRetrievalOptions = {},
  context: SelectionContext = {}
): MemoryRetrievalResult {
  const { topK, minScore, tokenBudget } = { ...DEFAULT_MEMORY_OPTIONS, ...options };
  const uses = context.recentUses;
  const vectors = context.vectors;

  const selected: ScoredMemory[] = [];
  const rejected: ScoredMemory[] = [];
  let remaining = tokenBudget;

  // Pinned first: always in.
  const candidates: ScoredMemory[] = [];
  for (const candidate of scored) {
    if (candidate.pinned) {
      selected.push(candidate);
      remaining -= estimateTokens(candidate.memory.content);
    } else if (candidate.score < minScore) {
      rejected.push(candidate);
    } else {
      candidates.push(candidate);
    }
  }
  selected.sort((a, b) => b.score - a.score);

  const adjusted = new Map<string, number>();
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const c = candidates[i];
    const timesUsed = uses?.get(c.memory.id) ?? 0;
    if (timesUsed >= RECENT_USE_LIMIT) {
      rejected.push(c);
      candidates.splice(i, 1);
      continue;
    }
    adjusted.set(c.memory.id, c.score - RECENT_USE_PENALTY * Math.min(timesUsed, RECENT_USE_CAP));
  }
  const adj = (c: ScoredMemory) => adjusted.get(c.memory.id) ?? c.score;

  const room = () => selected.length < topK;
  const take = (candidate: ScoredMemory): boolean => {
    const cost = estimateTokens(candidate.memory.content);
    if (cost > remaining) return false; // over budget: skipped, a later and shorter one may still fit
    selected.push(candidate);
    remaining -= cost;
    return true;
  };
  const left = new Set(candidates);

  // Held slots: the best matches among the founding (oldest) memories.
  const byAge = [...candidates].sort((a, b) => a.memory.createdAt.localeCompare(b.memory.createdAt));
  const poolSize = Math.min(Math.ceil(byAge.length / 2), Math.max(ANCHOR_POOL_MIN, Math.ceil(byAge.length * ANCHOR_POOL_SHARE)));
  const older = new Set(byAge.slice(0, poolSize).map((c) => c.memory.id));
  let anchorsToTake = Math.floor(Math.max(0, topK - selected.length) * ANCHOR_SHARE);
  for (const candidate of [...candidates].filter((c) => older.has(c.memory.id)).sort((a, b) => adj(b) - adj(a))) {
    if (anchorsToTake <= 0 || !room()) break;
    if (take(candidate)) {
      left.delete(candidate);
      anchorsToTake -= 1;
    }
  }

  // The rest: relevance, discounted by similarity to what is already chosen.
  const similarityToChosen = (candidate: ScoredMemory): number => {
    const v = vectors?.get(candidate.memory.id);
    if (!v) return 0;
    let highest = 0;
    for (const other of selected) {
      const w = vectors?.get(other.memory.id);
      if (w) highest = Math.max(highest, dot(v, w));
    }
    return highest;
  };
  while (room() && left.size > 0) {
    let best: ScoredMemory | null = null;
    let bestValue = -Infinity;
    for (const candidate of left) {
      const value = MMR_RELEVANCE * adj(candidate) - (1 - MMR_RELEVANCE) * similarityToChosen(candidate);
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }
    if (!best) break;
    left.delete(best);
    if (!take(best)) rejected.push(best);
  }
  for (const candidate of left) rejected.push(candidate);
  rejected.sort((a, b) => b.score - a.score);

  return {
    query,
    selected,
    rejected,
    totalAvailable: scored.length,
    budgetTokensUsed: tokenBudget - remaining,
    budgetTokensMax: tokenBudget,
  };
}

export interface RetrievalOutcome {
  result: MemoryRetrievalResult;
  /** Embeddings computed this turn, to be written back to the cache by the caller. */
  computed: { memoryId: string; vector: number[]; model: string }[];
  /** Set when embedding failed -- retrieval degraded to pinned-only rather than throwing. */
  degradedReason: string | null;
}

/**
 * Embeds the query (and any memory missing a cached vector), then selects.
 *
 * Only uncached memories are embedded, so a settled conversation costs exactly one embed
 * call per turn rather than one per stored memory.
 *
 * If embedding fails -- no Ollama, no embedding model pulled -- retrieval degrades to
 * pinned memories only rather than throwing. Losing semantic recall is a worse turn; losing
 * the whole reply is a broken app, and the user's manual memories are the ones they'd most
 * notice missing.
 */
export async function retrieveMemories(
  ollama: OllamaClient,
  query: string,
  memories: MemoryWithEmbedding[],
  options: MemoryRetrievalOptions = {},
  /** In how many recent turns each memory was injected (see SelectionContext). */
  recentUses?: ReadonlyMap<string, number>
): Promise<RetrievalOutcome> {
  const { embeddingModel } = { ...DEFAULT_MEMORY_OPTIONS, ...options };

  if (memories.length === 0) {
    return {
      result: selectMemories(query, [], options),
      computed: [],
      degradedReason: null,
    };
  }

  // A cached vector from a different model lives in a different embedding space; comparing
  // across them produces confident nonsense, so those are recomputed.
  const stale = memories.filter(
    (entry) => !entry.embedding || entry.embeddingModel !== embeddingModel
  );

  const computed: { memoryId: string; vector: number[]; model: string }[] = [];
  const vectors = new Map<string, number[]>();
  for (const entry of memories) {
    if (entry.embedding && entry.embeddingModel === embeddingModel) {
      vectors.set(entry.memory.id, l2Normalize(entry.embedding));
    }
  }

  let queryVector: number[] | null = null;
  let degradedReason: string | null = null;

  try {
    const inputs = [query, ...stale.map((entry) => entry.memory.content)];
    const embeddings = await ollama.embed(embeddingModel, inputs);
    if (embeddings.length !== inputs.length) {
      throw new Error(
        `embedding model returned ${embeddings.length} vectors for ${inputs.length} inputs`
      );
    }

    queryVector = l2Normalize(embeddings[0]);
    stale.forEach((entry, index) => {
      const raw = embeddings[index + 1];
      vectors.set(entry.memory.id, l2Normalize(raw));
      computed.push({ memoryId: entry.memory.id, vector: raw, model: embeddingModel });
    });
  } catch (error) {
    degradedReason = (error as Error).message;
  }

  const scored: ScoredMemory[] = memories.map((entry) => {
    const pinned = entry.memory.source === 'manual';
    const vector = vectors.get(entry.memory.id);
    const score = queryVector && vector ? dot(queryVector, vector) : 0;
    return { memory: entry.memory, score, pinned };
  });

  return { result: selectMemories(query, scored, options, { recentUses, vectors }), computed, degradedReason };
}
