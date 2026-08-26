/**
 * Prompt templates, ported verbatim from KVGenius's core/prompt_builder.py `_BUILTIN_DEFAULTS`.
 *
 * These live as constants for now. Phase 7 moves them into `app-config.json` (the same file
 * dbLocation.ts already owns) so they become user-editable; `buildSystemPrompt` already
 * accepts partial overrides, so that change is a wiring change rather than a rewrite.
 *
 * Placeholders use Python `str.format` single-brace syntax in the source. They are kept in
 * that form deliberately -- the templates are meant to be user-editable text, and matching
 * the original spelling means a user's KVGenius templates can be pasted in unchanged.
 */
export interface PromptTemplates {
  /** Baseline behaviour rules. Always injected when non-empty; takes no placeholders. */
  characterInstructions: string;
  /** Takes {persona_name} and {persona_background}. */
  personaContext: string;
  /** Takes {directions}. */
  directions: string;
  /** Takes {memories} -- a pre-rendered "- " bulleted list. */
  memory: string;
}

export interface StopPhraseSettings {
  base: string[];
  useCharacterNameAsStop: boolean;
  usePersonaNameAsStop: boolean;
}

export const DEFAULT_TEMPLATES: PromptTemplates = {
  characterInstructions: [
    '[CHARACTER RULES]',
    "You must ONLY write your own character's dialog and actions.",
    'NEVER write dialog, actions, or thoughts for the user or any other character.',
    'Wait for the user to provide their own words and actions.',
    '[/CHARACTER RULES]',
  ].join('\n'),

  personaContext: [
    '[USER PERSONA]',
    'The user is playing a character named "{persona_name}". Address them as {persona_name}.',
    "{persona_name}'s background: {persona_background}",
    '[/USER PERSONA]',
  ].join('\n'),

  directions: [
    '[CURRENT SCENE INSTRUCTIONS]',
    '{directions}',
    '[/CURRENT SCENE INSTRUCTIONS]',
  ].join('\n'),

  memory: [
    '[Key memories from this conversation - use these to maintain continuity:]',
    '{memories}',
  ].join('\n'),
};

/**
 * Note these carry a leading newline, unlike the bare-colon variants that ended up in
 * KVGenius's shipped `prompt_templates.yaml`. The `\n` prefix is what makes them safe: a
 * stop phrase of `"User:"` would also fire mid-sentence on "...told the User: hello",
 * truncating a legitimate reply.
 */
export const DEFAULT_STOP_PHRASES: StopPhraseSettings = {
  base: ['\nUser:', '\nAssistant:', '\n\n\n', '<|im_end|>', '</s>', '[INST]'],
  useCharacterNameAsStop: true,
  usePersonaNameAsStop: true,
};
