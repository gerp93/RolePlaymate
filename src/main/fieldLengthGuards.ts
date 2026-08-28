import { FIELD_LIMITS, assertMaxLength } from '../shared/fieldLimits';
import type { CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';
import type { CreateScenarioInput, UpdateScenarioInput } from '../shared/types/scenario';
import type { CreateUserPersonaInput, UpdateUserPersonaInput } from '../shared/types/userPersona';
import type {
  CreateLorebookInput,
  UpdateLorebookInput,
  CreateLorebookEntryInput,
  UpdateLorebookEntryInput,
} from '../shared/types/lorebook';
import type { StopPhraseSettings } from '../shared/types/promptTemplates';

function guardName(value: string | null | undefined, label = 'Name'): void {
  assertMaxLength(value, FIELD_LIMITS.name, label);
}

function guardShort(value: string | null | undefined, label = 'Description'): void {
  assertMaxLength(value, FIELD_LIMITS.short, label);
}

export function guardProseContent(value: string, label = 'Content'): void {
  assertMaxLength(value, FIELD_LIMITS.proseContent, label);
}

export function guardGreeting(value: string, label = 'Opening greeting'): void {
  assertMaxLength(value, FIELD_LIMITS.greeting, label);
}

export function guardLoreText(value: string, label = 'Entry text'): void {
  assertMaxLength(value, FIELD_LIMITS.loreText, label);
}

function guardLoreKeys(value: string | null | undefined): void {
  assertMaxLength(value, FIELD_LIMITS.loreKeys, 'Trigger keys');
}

export function guardChatMessage(value: string): void {
  assertMaxLength(value, FIELD_LIMITS.chatMessage, 'Message');
}

export function guardDirections(value: string | null | undefined): void {
  assertMaxLength(value, FIELD_LIMITS.directions, 'Directions');
}

function guardMemory(value: string): void {
  assertMaxLength(value, FIELD_LIMITS.memory, 'Memory');
}

function guardStopPhrasesText(value: string): void {
  assertMaxLength(value, FIELD_LIMITS.stopPhrases, 'Stop phrases');
}

export function guardUrl(value: string): void {
  assertMaxLength(value, FIELD_LIMITS.url, 'URL');
}

function guardConversationTitle(value: string): void {
  assertMaxLength(value, FIELD_LIMITS.conversationTitle, 'Title');
}

export function guardCharacterCreate(input: CreateCharacterInput): void {
  guardName(input.name);
  guardShort(input.description);
}

export function guardCharacterUpdate(input: UpdateCharacterInput): void {
  guardName(input.name);
  guardShort(input.description);
}

export function guardScenarioCreate(input: CreateScenarioInput): void {
  guardName(input.name);
  guardShort(input.description, 'Description');
}

export function guardScenarioUpdate(input: UpdateScenarioInput): void {
  guardName(input.name);
  guardShort(input.description, 'Description');
}

export function guardPersonaCreate(input: CreateUserPersonaInput): void {
  guardName(input.name);
  guardShort(input.description);
}

export function guardPersonaUpdate(input: UpdateUserPersonaInput): void {
  guardName(input.name);
  guardShort(input.description);
}

export function guardLorebookCreate(input: CreateLorebookInput): void {
  guardName(input.name);
  guardShort(input.description);
}

export function guardLorebookUpdate(input: UpdateLorebookInput): void {
  guardName(input.name);
  guardShort(input.description);
}

export function guardLoreEntryCreate(input: CreateLorebookEntryInput): void {
  guardName(input.title, 'Title');
  guardLoreKeys(input.keys);
}

export function guardLoreEntryUpdate(input: UpdateLorebookEntryInput): void {
  guardName(input.title, 'Title');
  guardLoreKeys(input.keys);
}

export function guardStopPhrasesUpdate(partial: Partial<StopPhraseSettings>): void {
  if (partial.base) {
    guardStopPhrasesText(partial.base.join('\n'));
  }
}

export { guardMemory, guardConversationTitle };
