/** Whether a chat's large margin portrait auto-cycles through the gallery (every 10s) or is
 * pinned to one specific image for the whole conversation. Independent per side (character vs.
 * persona) -- see Conversation's four image fields below. Only affects the margin portraits;
 * a message bubble's small avatar always shows the gallery's cover image regardless of mode. */
export type ImageMode = 'carousel' | 'static';

/** A chat session against one character. `characterId` is nullable because deleting a
 * character sets it to NULL rather than cascading -- the transcript survives as a read-only
 * historical record instead of disappearing with the character. */
export interface Conversation {
  id: string;
  title: string;
  /** The Ollama model tag this conversation was started against, recorded so reopening an
   * old conversation can warn when the currently loaded model differs. */
  model: string;
  characterId: string | null;
  userPersonaId: string | null;
  /** Display-only, cosmetic -- never touches the model's context. Which specific image
   * `characterImageId`/`personaImageId` point to only matters when the corresponding mode is
   * 'static'; null means "use the cover image" (e.g. the pinned image was since deleted). */
  characterImageMode: ImageMode;
  characterImageId: string | null;
  personaImageMode: ImageMode;
  personaImageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationInput {
  characterId: string;
  model: string;
  userPersonaId?: string;
  /** Defaults to a truncated form of the first user message when omitted. */
  title?: string;
}
