import { CharacterFieldService } from '../database/characterFieldService';
import { FieldVersionService } from '../database/fieldVersionService';
import { CharacterService } from '../database/characterService';
import { FieldType } from '../../shared/types/characterField';
import { BuiltPrompt } from '../../shared/types/chat';
import {
  DEFAULT_TEMPLATES,
  DEFAULT_STOP_PHRASES,
  PromptTemplates,
  StopPhraseSettings,
} from './promptTemplates';

export interface PromptBuildOptions {
  personaName?: string | null;
  personaBackground?: string | null;
  /** Already-retrieved memory texts, rendered as a bulleted list into the memory template. */
  memories?: string[];
  /** Per-turn scene instructions. Transient -- never stored on the conversation. */
  directions?: string;
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

export class PromptBuilder {
  constructor(
    private characters: CharacterService,
    private fields: CharacterFieldService,
    private versions: FieldVersionService
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

    const templates = { ...DEFAULT_TEMPLATES, ...options.templates };
    const stopSettings = { ...DEFAULT_STOP_PHRASES, ...options.stopPhrases };
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

    const characterInstructions = templates.characterInstructions.trim();
    if (characterInstructions) parts.push(characterInstructions);

    if (personaName && personaBackground) {
      parts.push(
        fill(templates.personaContext, {
          persona_name: personaName,
          persona_background: substituteMacros(personaBackground, character.name, userName),
        }).trim()
      );
    }

    const memories = options.memories?.filter((m) => m.trim()) ?? [];
    if (memories.length > 0) {
      const rendered = memories.map((m) => `- ${m.trim()}`).join('\n');
      parts.push(fill(templates.memory, { memories: rendered }).trim());
    }

    const directions = options.directions?.trim();
    if (directions) {
      parts.push(fill(templates.directions, { directions }).trim());
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
