/** Who *you* are roleplaying as in a conversation -- the counterpart to a Character, which
 * is who the AI plays. Kept separate from the character library on purpose: the library
 * means "AI characters", and personas have no versioning or portrait gallery. */
export interface UserPersona {
  id: string;
  name: string;
  description: string | null;
  /** Injected into the system prompt as the persona's history. The persona block is only
   * added when both name and background are non-empty -- a persona with no background
   * contributes nothing, so it is skipped rather than emitted as an empty section. */
  background: string | null;
  avatar: string | null;
  createdAt: string;
}

export interface CreateUserPersonaInput {
  name: string;
  description?: string;
  background?: string;
  avatar?: string;
}

export interface UpdateUserPersonaInput {
  name?: string;
  description?: string;
  background?: string;
  avatar?: string;
}
