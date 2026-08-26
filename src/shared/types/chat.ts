import { Message } from './message';
import { MemoryRetrievalResult } from './conversationMemory';

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
  | { streamId: string; type: 'error'; message: string }
  | { streamId: string; type: 'cancelled' };
