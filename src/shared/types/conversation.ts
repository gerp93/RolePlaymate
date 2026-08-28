/** Whether a chat's large margin portrait auto-cycles through the gallery (every 10s) or is
 * pinned to one specific image for the whole conversation. Independent per side (character vs.
 * persona) -- see Conversation's four image fields below. Only affects the margin portraits;
 * a message bubble's small avatar always shows the gallery's cover image regardless of mode. */
export type ImageMode = 'carousel' | 'static';

/** A chat session against one character. `characterId` is typed nullable for historical
 * reasons -- a conversation whose character was deleted before deletion started cascading (see
 * characterService.deleteCharacter) may still carry a leftover NULL from the old ON DELETE SET
 * NULL behavior. Going forward, deleting a character deletes its conversations outright rather
 * than orphaning them. */
export interface Conversation {
  id: string;
  title: string;
  /** The Ollama model tag this conversation was started against, recorded so reopening an
   * old conversation can warn when the currently loaded model differs. */
  model: string;
  characterId: string | null;
  userPersonaId: string | null;
  /** Which of this character's Scenarios (if any) this conversation is set in -- see
   * shared/types/scenario.ts. Null means no scenario selected; behaves exactly as if the
   * character had none. Fixed at conversation start; not swappable mid-conversation. */
  scenarioId: string | null;
  /** Display-only, cosmetic -- never touches the model's context. Which specific image
   * `characterImageId`/`personaImageId`/`scenarioImageId` point to only matters when the
   * corresponding mode is 'static'; null means "use the cover image" (e.g. the pinned image
   * was since deleted). `characterImageId` and `scenarioImageId` are mutually exclusive -- at
   * most one is ever set, since they both pin the same character-side portrait slot; see
   * conversationService.setConversationScenario. */
  characterImageMode: ImageMode;
  characterImageId: string | null;
  scenarioImageId: string | null;
  personaImageMode: ImageMode;
  personaImageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationInput {
  characterId: string;
  model: string;
  userPersonaId?: string;
  scenarioId?: string;
  /** Defaults to a truncated form of the first user message when omitted. */
  title?: string;
}

/** Sidebar list row -- everything in {@link Conversation} plus display fields computed from
 * messages and the linked scenario. */
export interface ConversationListItem extends Conversation {
  messageCount: number;
  /** User turns only. A greeting-only draft has 0; a continue-only thread may also have 0 but
   * messageCount > 1, which is what keeps it in the sidebar. */
  userMessageCount: number;
  lastMessageAt: string | null;
  scenarioName: string | null;
}
