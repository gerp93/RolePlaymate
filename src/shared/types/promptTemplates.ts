/**
 * Shapes for the user-editable system prompt templates (src/main/chat/promptTemplates.ts owns
 * the actual default text; this file just holds the types both processes need -- the renderer
 * for the Settings UI, the main process for building prompts).
 *
 * Each template is body text ONLY -- the `[TAG]`/`[/TAG]` wrapper around it is fixed (see
 * `TEMPLATE_TAGS` below) and not part of what's stored or user-editable. A user swapping which
 * words go between the brackets can't accidentally drop or mismatch a closing tag and confuse
 * the model about where a section ends; changing the wrapper convention itself (different
 * bracket style entirely) isn't offered as a customization.
 */
export interface PromptTemplates {
  /** Baseline behaviour rules. Always injected when non-empty. Takes {char} and
   * {persona_name}. */
  characterInstructions: string;
  /** Takes {persona_name} and {persona_background}. */
  personaContext: string;
  /** Takes {directions}. */
  directions: string;
  /** Takes {memories} -- a pre-rendered "- " bulleted list. */
  memory: string;
  /** Shared setting material. Takes {lore}. */
  worldLore: string;
  /** The character's own history. Takes {lore} and {char}. */
  personalLore: string;
  /** The persona's own history -- personalLore's counterpart for {{user}} rather than
   * {{char}}. Takes {lore} and {persona}. */
  personaLore: string;
}

/** The locked `[TAG]`/`[/TAG]` text wrapped around each template's body (see PromptTemplates'
 * doc comment). `personalLore`/`personaLore`'s tags carry their own placeholder ({char}/
 * {persona}) resolved the same way the body is. */
export const TEMPLATE_TAGS: Record<keyof PromptTemplates, string> = {
  characterInstructions: 'CHARACTER RULES',
  personaContext: 'USER PERSONA',
  directions: 'CURRENT SCENE INSTRUCTIONS',
  memory: 'MEMORY',
  worldLore: 'WORLD INFORMATION',
  personalLore: '{char} - PERSONAL HISTORY',
  personaLore: '{persona} - PERSONAL HISTORY',
};

export interface StopPhraseSettings {
  base: string[];
  useCharacterNameAsStop: boolean;
  usePersonaNameAsStop: boolean;
}

/** The fixed set of template field keys, in the same order the Settings page displays them. */
export const TEMPLATE_FIELD_KEYS: (keyof PromptTemplates)[] = [
  'characterInstructions',
  'personaContext',
  'directions',
  'memory',
  'worldLore',
  'personalLore',
  'personaLore',
];

/** A single saved version of one prompt template field's body text -- same shape as
 * CharacterFieldVersion, keyed by `fieldKey` (one of the fixed PromptTemplates keys) instead
 * of an opaque per-character field id, since prompt fields aren't owned by anything. */
export interface PromptFieldVersion {
  id: string;
  fieldKey: keyof PromptTemplates;
  versionNumber: number;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
