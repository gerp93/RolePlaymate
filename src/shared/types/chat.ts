import { Message } from './message';
import { MemoryRetrievalResult } from './conversationMemory';
import { LoreScanResult } from './lorebook';

/** Sampler knobs passed through to Ollama. Only temperature and maxTokens are exposed in the
 * chat UI (matching KVGenius); the rest come from settings. They are sent regardless --
 * the original persisted topP/topK on each character and then never passed them to the
 * model, which made them look configurable when they did nothing. */
export interface SamplerParams {
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
}

/** Per-model sampler overrides -- see Model Tuning settings page. Every field nullable: a
 * model with no row (or a row with some fields left null) falls back to DEFAULT_SAMPLERS for
 * whichever fields aren't set, the same merge convention a chat-level override already uses
 * over the global default. Applied as a layer *underneath* a chat-level override (the Composer
 * sliders), not instead of it -- a per-turn temperature/maxTokens change still wins. */
export interface ModelSamplerDefaults {
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  topK: number | null;
  repetitionPenalty: number | null;
  updatedAt: string;
}

/** Everything the Prompt Debug Console renders. Assembled as one object rather than being
 * stuffed into a global dict after the fact, which is what the source had to do because
 * generating cleared the dict first. */
export interface ChatDebugInfo {
  /** Section 1 of the assembled prompt: composed from the character's active field versions. */
  baseSystemPrompt: string;
  /** Section 2: the always-injected behaviour rules. */
  characterInstructions: string;
  personaName: string;
  personaBackground: string;
  /** Section 5: per-turn scene directions, never persisted. */
  directions: string;
  /** Section 4, after retrieval: the memory texts actually injected. */
  memories: string[];
  retrieval: MemoryRetrievalResult | null;
  /** What the lore scan selected and rejected this turn, so a misfiring entry can be
   * diagnosed in the debug console rather than by guesswork. */
  lore: LoreScanResult | null;
  /** The fully assembled system prompt, i.e. sections 1-5 joined. */
  systemPrompt: string;
  userMessage: string;
  /** Prior turns included in the request, after the sliding-window trim. */
  historyTurns: { role: string; content: string }[];
  historyLength: number;
  /** The whole request rendered as [SYSTEM]/[USER]/[ASSISTANT] blocks, for eyeballing. */
  fullPrompt: string;
  stopPhrases: string[];
  rawResponse: string;
  cleanedResponse: string;
  inputTokens: number | null;
  outputTokens: number | null;
  error?: string;
}

/** The assembled prompt for one turn, returned across IPC so the renderer (and the debug
 * console) can show what would be sent without the main process having to re-derive it. */
export interface BuiltPrompt {
  /** Sections 1-5 joined with a blank line. */
  prompt: string;
  characterName: string;
  /** Section 1 alone -- what the character's own field versions contributed. */
  baseSystemPrompt: string;
  /** Section 2 alone. */
  characterInstructions: string;
  stopPhrases: string[];
  /** The character's active greeting, macro-substituted. Seeded as a conversation's first
   * assistant message rather than being part of the system prompt. */
  greeting: string;
}

export interface ChatSendRequest {
  conversationId: string;
  message: string;
  /** Per-turn only; injected into this request's system prompt and then discarded. */
  directions?: string;
  samplers?: Partial<SamplerParams>;
}

export interface ChatRegenerateRequest {
  conversationId: string;
  samplers?: Partial<SamplerParams>;
  /** Falls back to whichever model produced the response being redone when omitted. */
  model?: string;
}

/**
 * Streaming events pushed from the main process over a single `chat:stream` channel.
 * One discriminated union rather than four channels: one listener registration, one switch,
 * one cleanup path.
 *
 * Exactly one terminal event ('done' | 'error' | 'cancelled') is always emitted, even when
 * generation throws. The renderer must only ever clear its generating flag on a terminal
 * event -- the source app had no try/except around its generate body, so an exception left
 * the UI stuck generating forever.
 */
export type ChatStreamEvent =
  | { streamId: string; type: 'token'; text: string }
  | {
      streamId: string;
      type: 'done';
      message: Message;
      debug: ChatDebugInfo;
    }
  | {
      streamId: string;
      /** Terminal event for a redo: same payload shape as 'done', but the renderer replaces
       * the existing message in place rather than appending a new one. */
      type: 'variantDone';
      message: Message;
      debug: ChatDebugInfo;
    }
  | { streamId: string; type: 'error'; message: string }
  | { streamId: string; type: 'cancelled' };
