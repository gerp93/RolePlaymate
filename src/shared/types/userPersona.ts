/** Who *you* are roleplaying as in a conversation -- the counterpart to a Character, which
 * is who the AI plays. Kept separate from the character library on purpose: the library
 * means "AI characters". Personas have a portrait gallery (persona_images, see
 * personaImageService.ts) mirroring characters', and `background` now has version history
 * (persona_background_versions, see personaFieldVersionService.ts) mirroring a character
 * field's -- name/description stay plain, single-shot fields, same as a character's own name
 * and description. */
export interface UserPersona {
  id: string;
  name: string;
  description: string | null;
  /** The currently-active background version's content -- see PersonaBackgroundVersion. Not
   * writable directly; only through personaFieldVersions:* (create/duplicate/delete a
   * version). Injected into the system prompt as the persona's history; the persona block is
   * only added when both name and background are non-empty -- a persona with no background
   * contributes nothing, so it is skipped rather than emitted as an empty section. */
  background: string | null;
  /** Superseded by the persona_images gallery -- left in place (unused going forward) purely
   * so migrateLegacyPersonaAvatars in schema.ts can still read pre-existing single avatars on
   * upgrade, same convention as characters.image_url. */
  avatar: string | null;
  isHidden: boolean;
  createdAt: string;
}

export interface CreateUserPersonaInput {
  name: string;
  description?: string;
  /** Seeds the persona's first background version (v1) -- see
   * PersonaFieldVersionService.createVersion. */
  background?: string;
  avatar?: string;
}

export interface UpdateUserPersonaInput {
  name?: string;
  description?: string;
  avatar?: string;
}

/** One saved version of a persona's background -- same shape as CharacterFieldVersion, keyed
 * by `personaId` directly rather than through a fields-table indirection, since a persona has
 * exactly one versionable field rather than several field *types* per owner. */
export interface PersonaBackgroundVersion {
  id: string;
  personaId: string;
  versionNumber: number;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
