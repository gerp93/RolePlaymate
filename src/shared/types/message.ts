export type MessageRole = 'user' | 'assistant' | 'system';

/** One turn in a conversation. Messages are a flat, ordered list -- `seq` is the ordering
 * key rather than `createdAt`, which is only second-granular and can tie on fast turns. */
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  /** Mirrors whichever variant `selectedVariantId` points to, for an assistant message with
   * more than one redo candidate. Every existing reader of a message's text keeps working
   * unchanged; only the redo UI needs to look past this to the variant list. */
  content: string;
  /** Null for user/system messages, and for an assistant message that predates redo support. */
  selectedVariantId: string | null;
  /** Mirrors the selected variant's model, same convention as content. Null for user/system
   * messages and for an assistant message that predates this column. */
  model: string | null;
  /** Mirrors the selected variant's generation time, same convention as content/model. Null
   * for user/system messages and for an assistant message that predates this column. */
  generationMs: number | null;
  /** Absolute path of the saved spoken WAV for this row (user) or the selected variant
   * (assistant). Null until speech has been generated once. Replay reads this file instead of
   * calling Chatterbox again. */
  ttsAudioPath: string | null;
  /** Per-turn scene directions attached when this user message was sent, or null. Unlike the
   * debug log's directions (what was actually injected into that turn's prompt, never itself
   * editable after the fact), this is the stored, editable value on the message row -- editing
   * it re-injects the new text when the reply is regenerated. Null for assistant/system
   * messages and for a user message that predates this column. */
  directions: string | null;
  /** Which character spoke this assistant message in a group conversation. Null for user/system
   * messages, for every message of a one-character conversation, and after that character is
   * deleted -- `speakerName` then still labels the line. */
  speakerCharacterId: string | null;
  /** Snapshot of the speaker's name at the time, so a group transcript stays readable after the
   * character is renamed away or deleted. Null wherever `speakerCharacterId` was never set. */
  speakerName: string | null;
  /** Monotonic within a conversation, allocated inside the insert transaction. */
  seq: number;
  createdAt: string;
}

export interface CreateMessageInput {
  conversationId: string;
  role: MessageRole;
  content: string;
}

/** One redo candidate for an assistant message. The first response is variant #1 same as any
 * redo -- there is no special case for "the original" reply. */
export interface MessageVariant {
  id: string;
  messageId: string;
  content: string;
  model: string | null;
  /** Wall-clock time this variant took to generate, in milliseconds. Null for variants that
   * predate this column, or that were never produced by a model call (e.g. a hand-edited
   * message). Powers the Model Tuning page's per-model average response time. */
  generationMs: number | null;
  /** Saved spoken WAV for this redo candidate. Independent of other variants -- switching
   * back to one that was already spoken replays it without regenerating. */
  ttsAudioPath: string | null;
  /** User-bookmarked, independent of which variant is currently selected -- lets a good redo
   * candidate stay reachable via a quick-jump chip even after browsing past it. */
  starred: boolean;
  createdAt: string;
}

/** Spoken WAV for what's currently on screen. Assistant redos each have their own file --
 * never reuse another variant's clip just because they share a message id. */
export function ttsPathForMessage(
  message: Message,
  variants: readonly MessageVariant[] = []
): string | null {
  if (message.role === 'assistant' && message.selectedVariantId) {
    const variant = variants.find((v) => v.id === message.selectedVariantId);
    if (variant) return variant.ttsAudioPath;
  }
  return message.ttsAudioPath;
}
