/** How a memory came to exist. 'manual' memories are pinned: they are always injected into
 * the prompt, bypassing both the similarity threshold and the token budget, on the grounds
 * that the user asked for them explicitly. */
export type MemorySource = 'auto' | 'manual';

/** A fact worth carrying across a long conversation, so the model keeps continuity without
 * the whole transcript being resent. 'auto' rows are extracted by the model after a turn. */
export interface ConversationMemory {
  id: string;
  conversationId: string;
  content: string;
  source: MemorySource;
  createdAt: string;
}

export interface CreateMemoryInput {
  conversationId: string;
  content: string;
  source: MemorySource;
}

/** One memory scored against the current turn's query during retrieval. */
export interface ScoredMemory {
  memory: ConversationMemory;
  /** Cosine similarity in [-1, 1]; higher is more relevant. */
  score: number;
  /** True for 'manual' memories, which are selected regardless of score or budget. */
  pinned: boolean;
}

/** The outcome of one retrieval pass, kept whole so the debug console can show not just
 * what was injected but what was considered and rejected, and why. */
export interface MemoryRetrievalResult {
  query: string;
  selected: ScoredMemory[];
  rejected: ScoredMemory[];
  totalAvailable: number;
  budgetTokensUsed: number;
  budgetTokensMax: number;
}
