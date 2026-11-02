/**
 * A read-only snapshot of the library for the assistant's tools: every character, persona, scenario,
 * group and book with the text of its ACTIVE version, already filtered for the hidden-items PIN.
 *
 * The snapshot is rebuilt on each tool call rather than cached. A cache would go stale the moment the
 * user applies a proposal or edits a card in another window, and the library is small enough
 * (hundreds of rows, synchronous SQLite) that rebuilding costs less than getting invalidation wrong.
 */
import type { DatabaseSync } from '../database/sqlite';
import { CharacterService } from '../database/characterService';
import { CharacterFieldService } from '../database/characterFieldService';
import { FieldVersionService } from '../database/fieldVersionService';
import { ConversationService } from '../database/conversationService';
import { PersonaFieldVersionService } from '../database/personaFieldVersionService';
import { ScenarioService } from '../database/scenarioService';
import { GroupService } from '../database/groupService';
import { LorebookService } from '../database/lorebookService';
import { SecurityService } from '../database/securityService';
import type { FieldType } from '../../shared/types/characterField';

export interface LibraryServices {
  db: DatabaseSync;
  characters: CharacterService;
  fields: CharacterFieldService;
  fieldVersions: FieldVersionService;
  conversations: ConversationService;
  personaVersions: PersonaFieldVersionService;
  scenarios: ScenarioService;
  groups: GroupService;
  lorebooks: LorebookService;
  security: SecurityService;
}

export interface LibCharacter {
  id: string;
  name: string;
  description: string;
  personality: string;
  dialogue: string;
  hidden: boolean;
  isQuick: boolean;
  worldBooks: string[];
}

export interface LibPersona {
  id: string;
  name: string;
  description: string;
  background: string;
  hidden: boolean;
}

export interface LibScenario {
  id: string;
  name: string;
  description: string;
  content: string;
  greeting: string;
  ownerKind: 'character' | 'group';
  ownerId: string;
  ownerName: string;
  hidden: boolean;
}

export interface LibGroup {
  id: string;
  name: string;
  description: string;
  instructions: string;
  members: string[];
  hidden: boolean;
}

export interface LibLoreEntry {
  id: string;
  title: string;
  keys: string;
  content: string;
}

export interface LibBook {
  id: string;
  name: string;
  description: string;
  scope: 'world' | 'personal';
  /** For a personal book, whose history it is. */
  ownerName: string | null;
  hidden: boolean;
  entries: LibLoreEntry[];
}

export interface Library {
  characters: LibCharacter[];
  personas: LibPersona[];
  scenarios: LibScenario[];
  groups: LibGroup[];
  books: LibBook[];
}

function activeFieldText(s: LibraryServices, characterId: string, type: FieldType): string {
  const field = s.fields.getFieldsByCharacter(characterId).find((f) => f.fieldType === type);
  if (!field) return '';
  return s.fieldVersions.getVersionsByField(field.id).find((v) => v.isActive)?.content ?? '';
}

function loadBook(s: LibraryServices, book: ReturnType<LorebookService['getBook']> & object, ownerName: string | null, hidden: boolean): LibBook {
  return {
    id: book.id,
    name: book.name,
    description: book.description ?? '',
    scope: book.scope,
    ownerName,
    hidden,
    entries: s.lorebooks.listEntries(book.id).map((entry) => ({
      id: entry.id,
      title: entry.title,
      keys: entry.keys,
      content: s.lorebooks.getActiveContent(entry.id),
    })),
  };
}

/** Everything the current lock state lets the assistant see. Hidden rows are left out entirely while
 * locked (not blanked), so a locked assistant cannot even learn that they exist. */
export function loadLibrary(s: LibraryServices): Library {
  const unlocked = s.security.isUnlocked();
  const see = (hidden: boolean) => unlocked || !hidden;

  const allCharacters = s.characters.getAllCharacters();
  const characterHidden = new Map(allCharacters.map((c) => [c.id, c.isHidden]));
  const characterName = new Map(allCharacters.map((c) => [c.id, c.name]));

  const characters: LibCharacter[] = [];
  for (const c of allCharacters) {
    if (!see(c.isHidden)) continue;
    characters.push({
      id: c.id,
      name: c.name,
      description: c.description ?? '',
      personality: activeFieldText(s, c.id, 'personality'),
      dialogue: activeFieldText(s, c.id, 'dialogue'),
      hidden: c.isHidden,
      isQuick: c.isQuick,
      worldBooks: s.lorebooks.getBooksForCharacter(c.id).world.filter((b) => see(b.isHidden)).map((b) => b.name),
    });
  }

  const allPersonas = s.conversations.listPersonas();
  const personas: LibPersona[] = allPersonas
    .filter((p) => see(p.isHidden))
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      background: p.background ?? '',
      hidden: p.isHidden,
    }));

  const allGroups = s.groups.getAllGroups();
  const groupHidden = new Map<string, boolean>();
  const groups: LibGroup[] = [];
  for (const g of allGroups) {
    // A group is as private as its most private member: listing it would name them.
    const hidden = g.isHidden || g.members.some((m) => characterHidden.get(m.characterId));
    groupHidden.set(g.id, hidden);
    if (!see(hidden)) continue;
    groups.push({
      id: g.id,
      name: g.name,
      description: g.description ?? '',
      instructions: g.instructions ?? '',
      members: g.members.map((m) => characterName.get(m.characterId) ?? 'Unknown'),
      hidden,
    });
  }

  const scenarios: LibScenario[] = [];
  const addScenario = (scenario: { id: string; name: string; description: string | null; isHidden: boolean }, ownerKind: 'character' | 'group', ownerId: string, ownerName: string, ownerHidden: boolean) => {
    const hidden = scenario.isHidden || ownerHidden;
    if (!see(hidden)) return;
    scenarios.push({
      id: scenario.id,
      name: scenario.name,
      description: scenario.description ?? '',
      content: s.scenarios.getActiveContent(scenario.id),
      greeting: s.scenarios.getActiveGreeting(scenario.id),
      ownerKind,
      ownerId,
      ownerName,
      hidden,
    });
  };
  for (const c of allCharacters) {
    for (const scenario of s.scenarios.getScenariosByCharacter(c.id)) addScenario(scenario, 'character', c.id, c.name, c.isHidden);
  }
  for (const g of allGroups) {
    for (const scenario of s.scenarios.getScenariosByGroup(g.id)) {
      addScenario(scenario, 'group', g.id, g.name, groupHidden.get(g.id) ?? false);
    }
  }

  const books: LibBook[] = [];
  for (const book of s.lorebooks.listWorldBooks()) {
    if (see(book.isHidden)) books.push(loadBook(s, book, null, book.isHidden));
  }
  for (const c of allCharacters) {
    const personal = s.lorebooks.getBooksForCharacter(c.id).personal;
    if (personal && see(personal.isHidden || c.isHidden)) {
      books.push(loadBook(s, personal, c.name, personal.isHidden || c.isHidden));
    }
  }
  for (const p of allPersonas) {
    const personal = s.lorebooks.getBooksForPersona(p.id).personal;
    if (personal && see(personal.isHidden || p.isHidden)) {
      books.push(loadBook(s, personal, p.name, personal.isHidden || p.isHidden));
    }
  }

  return { characters, personas, scenarios, groups, books };
}
