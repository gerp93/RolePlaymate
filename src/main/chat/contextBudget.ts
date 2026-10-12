import type { OllamaChatMessage } from './ollamaClient';

/** The context window every chat request asks Ollama for when the user has not chosen one (Model Tuning). */
export const DEFAULT_CONTEXT_WINDOW = 8192;
export const MIN_CONTEXT_WINDOW = 2048;
export const MAX_CONTEXT_WINDOW = 131072;

/** Reply length assumed when a request does not say. */
const DEFAULT_REPLY_TOKENS = 512;
/** Per-message overhead of a chat template (role markers and separators), in tokens. */
const MESSAGE_OVERHEAD = 6;
/** Share of the window the prompt may fill: the rest is slack for an estimate that is only roughly right. */
const FILL = 0.92;

/** The usual rough count: about four characters a token. Measured here at 4.5 on roleplay text, so this
 * errs on the side of dropping slightly early rather than being cut off by the server. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface FittedMessages {
  messages: OllamaChatMessage[];
  /** How many of the oldest messages were left out to make the rest fit. */
  dropped: number;
}

/**
 * Leaves out the oldest conversation messages so the prompt (plus the reply) fits the context window.
 *
 * Without this Ollama does it itself, and does it badly: when a prompt is over the window it drops old
 * messages one at a time, which can leave the conversation starting with the assistant. A model with a strict
 * user/assistant/user template (Mistral-family, e.g. magnum:22b) then refuses the whole request (HTTP 400,
 * "conversation roles must alternate") -- found when a perfectly alternating conversation failed once it
 * passed ~4000 tokens and worked again with a larger window.
 *
 * So: the system message and the latest messages are always kept, the oldest go first, and the conversation
 * never starts on an assistant message after the cut. If even the system message alone is too big, nothing
 * more can be done here and the request is sent as it is.
 */
export function fitMessagesToContext(
  messages: OllamaChatMessage[],
  contextWindow: number,
  replyTokens: number = DEFAULT_REPLY_TOKENS
): FittedMessages {
  const budget = Math.floor((contextWindow - replyTokens) * FILL);
  const cost = (m: OllamaChatMessage) => estimateTokens(m.content) + MESSAGE_OVERHEAD;

  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  let total = [...system, ...rest].reduce((sum, m) => sum + cost(m), 0);
  if (total <= budget) return { messages, dropped: 0 };

  let start = 0;
  // Always keep the final two messages (the user's turn and what it answers) at the very least.
  while (total > budget && rest.length - start > 2) {
    total -= cost(rest[start]);
    start += 1;
  }
  // The cut must not leave the conversation opening on the assistant.
  while (start < rest.length - 1 && rest[start].role === 'assistant') {
    total -= cost(rest[start]);
    start += 1;
  }
  if (start === 0) return { messages, dropped: 0 };
  return { messages: [...system, ...rest.slice(start)], dropped: start };
}
