import { CharacterFieldService } from '../database/characterFieldService';
import { FieldVersionService } from '../database/fieldVersionService';
import { CharacterService } from '../database/characterService';
import { PromptSettingsService } from '../database/promptSettingsService';
import { PromptFieldVersionService } from '../database/promptFieldVersionService';
import { FieldType } from '../../shared/types/characterField';
import { BuiltPrompt } from '../../shared/types/chat';
import { MatchedLoreEntry } from '../../shared/types/lorebook';
import {
  DEFAULT_STOP_PHRASES,
  PromptTemplates,
  StopPhraseSettings,
  TEMPLATE_TAGS,
} from './promptTemplates';

export interface PromptBuildOptions {
  personaName?: string | null;
  personaBackground?: string | null;
  /** Already-retrieved memory texts, rendered as a bulleted list into the memory template. */
  memories?: string[];
  /** Per-turn scene instructions. Transient -- never stored on the conversation. */
  directions?: string;
  /** Lore entries that fired this turn, already split by scope (see loreMatcher). */
  worldLore?: MatchedLoreEntry[];
  personalLore?: MatchedLoreEntry[];
  /** The persona's own personal history, scanned the same way as the character's. */
  personaLore?: MatchedLoreEntry[];
  templates?: Partial<PromptTemplates>;
  stopPhrases?: Partial<StopPhraseSettings>;
}

/** The active version's text for each of a character's fields; '' when a field is blank. */
export type ActiveFieldContent = Record<FieldType, string>;

const SECTION_SEPARATOR = '\n\n';

/** Fallback when no persona is selected, so `{{user}}` never renders literally. */
const DEFAULT_USER_NAME = 'User';

/**
 * Substitutes this app's character-card macros. Field content is authored with `{{char}}`
 * and `{{user}}` (see FormattedContent.tsx, which renders them as highlighted spans, and the
 * HTML importer, which produces them), so they must be resolved before the text is sent to a
 * model -- otherwise the model is asked to roleplay someone literally named "{{char}}".
 *
 * KVGenius has no equivalent step because it had no macro convention.
 */
export function substituteMacros(text: string, charName: string, userName: string): string {
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName);
}

/** Lore entries render titled so the model can tell one fact from another, rather than as a
 * wall of bullets where a two-sentence entry blurs into the next. */
function renderLore(entries: MatchedLoreEntry[]): string {
  return entries.map((entry) => `- ${entry.title}: ${entry.content}`).join('\n');
}

/** Wraps content in a bracket tag, matching the convention the templates already use. */
function section(tag: string, body: string): string {
  return `[${tag}]\n${body.trim()}\n[/${tag}]`;
}

/** Python-style single-brace `{name}` interpolation, matching the source's templates. Unknown
 * placeholders are left as-is rather than throwing, mirroring the source's KeyError fallback. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? values[key] : whole
  );
}

/** Fills a template field's body with `values` and, if anything's actually there, wraps it in
 * its fixed `[TAG]`/`[/TAG]` (also filled with `values`, since personalLore/personaLore's tags
 * carry their own {char}/{persona} placeholder). Returns '' for an empty body so the caller's
 * `if (x) parts.push(x)` skips the section entirely, matching every other section here. */
function wrappedSection(field: keyof PromptTemplates, templates: PromptTemplates, values: Record<string, string>): string {
  const body = fill(templates[field], values).trim();
  if (!body) return '';
  return section(fill(TEMPLATE_TAGS[field], values).trim(), body);
}

export class PromptBuilder {
  constructor(
    private characters: CharacterService,
    private fields: CharacterFieldService,
    private versions: FieldVersionService,
    private promptSettings: PromptSettingsService,
    private promptFieldVersions: PromptFieldVersionService
  ) {}

  /** The currently-active version text for each field type. `getVersionsByField` self-heals
   * the active-version invariant, so an active row is guaranteed when versions exist. */
  getActiveFieldContent(characterId: string): ActiveFieldContent {
    const content = {} as ActiveFieldContent;
    for (const field of this.fields.getFieldsByCharacter(characterId)) {
      const active = this.versions.getVersionsByField(field.id).find((v) => v.isActive);
      content[field.fieldType] = active?.content ?? '';
    }
    return content;
  }

  /**
   * Assembles the system prompt for one turn.
   *
   * Section order matches KVGenius's `build_system_prompt`, and each section is skipped
   * entirely when its input is blank -- an empty section header is worse than no section,
   * since it tells the model a category exists and is empty.
   *
   *   1. the character itself, composed from its active field versions
   *   2. character instructions -- always, when non-empty
   *   3. persona context -- only when BOTH persona name and background are present
   *   4. retrieved memories
   *   5. per-turn directions
   */
  buildSystemPrompt(characterId: string, options: PromptBuildOptions = {}): BuiltPrompt {
    const character = this.characters.getCharacterById(characterId);
    if (!character) {
      throw new Error(`Character with id ${characterId} not found`);
    }

    // Each template's currently-active version (see PromptFieldVersionService), then a per-call
    // override -- unused by any current caller, but kept for callers that want to override
    // without touching storage. Stop phrases are still the simpler nullable-override model.
    const templates = { ...this.promptFieldVersions.getActiveTemplates(), ...options.templates };
    const overrides = this.promptSettings.getOverrides();
    const stopSettings = { ...DEFAULT_STOP_PHRASES, ...overrides.stopPhrases, ...options.stopPhrases };
    const personaName = options.personaName?.trim() || null;
    const personaBackground = options.personaBackground?.trim() || null;
    const userName = personaName ?? DEFAULT_USER_NAME;

    const fieldContent = this.getActiveFieldContent(characterId);
    const resolve = (text: string) => substituteMacros(text, character.name, userName).trim();

    // --- Section 1: the character, from its active field versions -----------------------
    const identityLines = [`Name: ${character.name}`];
    if (character.description?.trim()) {
      identityLines.push(resolve(character.description));
    }

    const baseParts = [section('CHARACTER', identityLines.join('\n'))];
    const personality = resolve(fieldContent.personality ?? '');
    if (personality) baseParts.push(section('PERSONALITY', personality));
    const scenario = resolve(fieldContent.scenario ?? '');
    if (scenario) baseParts.push(section('SCENARIO', scenario));
    const dialogue = resolve(fieldContent.dialogue ?? '');
    // Labelled as examples, not as transcript, so the model treats it as style guidance
    // rather than as conversation that already happened.
    if (dialogue) baseParts.push(section('EXAMPLE DIALOGUE', dialogue));

    const baseSystemPrompt = baseParts.join(SECTION_SEPARATOR);

    // --- Sections 2-5 -------------------------------------------------------------------
    const parts: string[] = [baseSystemPrompt];

    // Every section is filled with this same standard placeholder set -- {lore} is the one
    // exception, overridden per section below since world/personal/persona lore are different
    // text, not the same value three times. A custom template can reference any of these
    // regardless of whether the default text for that field happens to use it.
    const memories = options.memories?.filter((m) => m.trim()) ?? [];
    const renderedMemories = memories.length > 0 ? memories.map((m) => `- ${m.trim()}`).join('\n') : '';
    const directions = options.directions?.trim() ?? '';
    const baseValues: Record<string, string> = {
      char: character.name,
      persona: userName,
      persona_background: personaBackground ? substituteMacros(personaBackground, character.name, userName) : '',
      directions,
      memories: renderedMemories,
      lore: '',
    };

    const characterInstructions = wrappedSection('characterInstructions', templates, baseValues);
    if (characterInstructions) parts.push(characterInstructions);

    // Persona context still only fires when BOTH a name and background are present -- a
    // persona with no background contributes nothing worth a section for.
    if (personaName && personaBackground) {
      parts.push(wrappedSection('personaContext', templates, baseValues));
    }

    // Lore before memories: setting facts are the stable backdrop, conversation memories are
    // the recent specifics, and the model weights later context more heavily.
    const worldLore = options.worldLore ?? [];
    if (worldLore.length > 0) {
      parts.push(wrappedSection('worldLore', templates, { ...baseValues, lore: renderLore(worldLore) }));
    }

    const personalLore = options.personalLore ?? [];
    if (personalLore.length > 0) {
      parts.push(wrappedSection('personalLore', templates, { ...baseValues, lore: renderLore(personalLore) }));
    }

    // Only meaningful with a persona actually selected -- personaLore entries only ever come
    // from a persona's own personal book, so this is empty whenever personaName is null anyway.
    const personaLore = options.personaLore ?? [];
    if (personaLore.length > 0 && personaName) {
      parts.push(wrappedSection('personaLore', templates, { ...baseValues, lore: renderLore(personaLore) }));
    }

    if (memories.length > 0) {
      parts.push(wrappedSection('memory', templates, baseValues));
    }

    if (directions) {
      parts.push(wrappedSection('directions', templates, baseValues));
    }

    return {
      prompt: parts.filter(Boolean).join(SECTION_SEPARATOR),
      characterName: character.name,
      baseSystemPrompt,
      characterInstructions,
      stopPhrases: buildStopPhrases(character.name, personaName, stopSettings),
      greeting: resolve(fieldContent.greeting ?? ''),
    };
  }
}

/**
 * Base stop phrases plus the speaker-name variants, which stop the model writing the other
 * side of the conversation for you.
 *
 * KVGenius skipped the persona stop for a persona literally named "Myself (Default)" -- a
 * sentinel from its seeded rows. Here the equivalent is simply having no persona selected.
 */
export function buildStopPhrases(
  characterName: string | null,
  personaName: string | null,
  settings: StopPhraseSettings = DEFAULT_STOP_PHRASES
): string[] {
  const phrases = [...settings.base];
  if (settings.useCharacterNameAsStop && characterName) {
    phrases.push(`\n${characterName}:`);
  }
  if (settings.usePersonaNameAsStop && personaName) {
    phrases.push(`\n${personaName}:`);
  }
  return phrases;
}
