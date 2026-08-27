import { OllamaClient } from './ollamaClient';
import {
  ConversationMemory,
  MemoryRetrievalResult,
  ScoredMemory,
} from '../../shared/types/conversationMemory';

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
  topK: 10,
  minScore: 0.25,
  tokenBudget: 400,
  embeddingModel: 'nomic-embed-text',
};

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

/**
 * Ranks and selects memories, mirroring the source's selection loop exactly.
 *
 * Three behaviours are deliberately preserved because they are intentional, not accidents:
 *
 *  1. Pinned ('manual') memories are always selected -- they bypass both the score
 *     threshold and the token budget, which the budget may go negative for. The user asked
 *     for them explicitly.
 *  2. Pinned memories still count toward `topK`, so a pile of manual memories can crowd out
 *     retrieved ones. That is a real bound on prompt bloat, not a bug.
 *  3. A candidate over the remaining budget is rejected but the walk continues, so a later,
 *     shorter memory can still fit.
 */
export function selectMemories(
  query: string,
  scored: ScoredMemory[],
  options: MemoryRetrievalOptions = {}
): MemoryRetrievalResult {
  const { topK, minScore, tokenBudget } = { ...DEFAULT_MEMORY_OPTIONS, ...options };

  // Pinned first, then by descending score.
  const ordered = [...scored].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.score - a.score;
  });

  const selected: ScoredMemory[] = [];
  const rejected: ScoredMemory[] = [];
  let remaining = tokenBudget;

  for (const candidate of ordered) {
    if (candidate.pinned) {
      selected.push(candidate);
      remaining -= estimateTokens(candidate.memory.content);
      continue;
    }
    if (candidate.score < minScore) {
      rejected.push(candidate);
      continue;
    }
    if (selected.length >= topK) {
      rejected.push(candidate);
      continue;
    }
    const cost = estimateTokens(candidate.memory.content);
    if (cost > remaining) {
      rejected.push(candidate);
      continue;
    }
    selected.push(candidate);
    remaining -= cost;
  }

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
  options: MemoryRetrievalOptions = {}
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

  return { result: selectMemories(query, scored, options), computed, degradedReason };
}
