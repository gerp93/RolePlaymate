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
