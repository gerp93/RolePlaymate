/**
 * Prompt templates, ported verbatim from KVGenius's core/prompt_builder.py `_BUILTIN_DEFAULTS`.
 *
 * The defaults live as constants here permanently -- user overrides are stored separately
 * (see promptSettingsService.ts) and merged on top in promptBuilder.ts, so these never change
 * at runtime and always serve as the "reset to default" target for the Settings UI
 * (src/renderer/pages/PromptSettings.tsx). The `PromptTemplates`/`StopPhraseSettings` shapes
 * themselves live in shared/types since both the renderer (Settings UI) and main process
 * (prompt building) need them.
 *
 * Placeholders use Python `str.format` single-brace syntax in the source. They are kept in
 * that form deliberately -- the templates are meant to be user-editable text, and matching
 * the original spelling means a user's KVGenius templates can be pasted in unchanged.
 */
import { PromptTemplates, StopPhraseSettings, TEMPLATE_TAGS } from '../../shared/types/promptTemplates';

export type { PromptTemplates, StopPhraseSettings };
export { TEMPLATE_TAGS };

/** Body text only -- promptBuilder.ts wraps each of these in its fixed `[TAG]`/`[/TAG]` (see
 * TEMPLATE_TAGS). Every field is filled with the same standard placeholder set: {char},
 * {persona}, {persona_background}, {directions}, {memories}, {lore} (that last one holds
 * whichever lore is relevant to *that* section -- world/personal/persona lore are different
 * text, not the same value three times). Unused placeholders in a given section's default
 * text simply aren't referenced there, but a custom override CAN use any of them -- fill()
 * always has the full set available, not just the ones the default happens to use. */
export const DEFAULT_TEMPLATES: PromptTemplates = {
  characterInstructions: [
    "You are ONLY {char}. Write ONLY {char}'s own dialogue, actions, and inner thoughts.",
    'Never write, imply, or continue dialogue, actions, or thoughts for {persona} or any',
    "other character -- that is exclusively {persona}'s to write, not yours.",
    "End your response as soon as {char} is done speaking or acting. Do not write a line",
    'starting with "{persona}:", and do not describe what {persona} says, does,',
    'thinks, or feels next. Stop and wait for {persona} to take their own turn.',
  ].join('\n'),

  personaContext: [
    'The user is playing a character named "{persona}". Address them as {persona}.',
    "{persona}'s background: {persona_background}",
  ].join('\n'),

  directions: '{directions}',

  memory: ['Key memories from this conversation -- use these to maintain continuity:', '{memories}'].join('\n'),

  // Framed as common knowledge -- anyone in the setting could know these, so the model is
  // free to have other characters reference them.
  worldLore: [
    'Established facts about the setting. Treat these as common knowledge and stay consistent',
    'with them. Do not recite them verbatim; use them only when they are relevant.',
    '{lore}',
  ].join('\n'),

  // Deliberately NOT framed as common knowledge. Without this distinction a model told
  // "the mutiny happened" as world fact will let any character reference it; told
  // "you remember the mutiny", it keeps the memory in this character's head and lets them
  // choose whether to reveal it.
  personalLore: [
    "These are {char}'s own memories and private history -- things {char} personally knows or",
    'lived through, NOT common knowledge. Other characters do not know these unless {char}',
    'chooses to tell them. Let them colour how {char} reacts rather than stating them outright.',
    '{lore}',
  ].join('\n'),

  // {{user}}'s counterpart to personalLore. Framed the same way -- private to the persona,
  // not common knowledge -- so a model that reads both sections doesn't treat the persona's
  // past as something {char} already knows.
  personaLore: [
    "These are {persona}'s own memories and private history -- things {persona} personally",
    'knows or lived through, NOT common knowledge to anyone else including {char}. Let them',
    "colour how {persona} is portrayed rather than being stated outright.",
    '{lore}',
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
