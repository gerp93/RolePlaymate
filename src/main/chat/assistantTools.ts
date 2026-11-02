/**
 * The library assistant's tools: what the model may look up and propose.
 *
 * `executeTool` is pure -- it takes an already-loaded, lock-filtered `Library` snapshot and returns
 * text for the model (and, for the two `propose_*` tools, a draft the user must approve). Nothing
 * here writes to the database; applying a proposal is `assistantApply.ts`, behind a button. That
 * split is the safety property of the whole feature, so keep it: a tool that writes would let a small
 * local model overwrite a card on a misread instruction.
 *
 * Tool results are plain text, not JSON: a 7-14B model reads a labelled list far more reliably than
 * it digests nested objects, and the same text is what the transcript stores.
 */
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import {
  CreatePayload,
  FIELDS_BY_ENTITY,
  NewVersionPayload,
  PROPOSAL_FIELD_LABELS,
  ProposalEntity,
  ProposalField,
} from '../../shared/types/assistant';
import type { OllamaToolDefinition } from './ollamaClient';
import type { Library, LibBook, LibCharacter, LibPersona, LibScenario } from './assistantLibrary';
import {
  clip,
  contentWords,
  jaccard,
  keywordScore,
  oneLine,
  queryWords,
  resolveOne,
  snippetAround,
} from './assistantText';

export interface ProposalDraft {
  action: 'newVersion' | 'create';
  entity: ProposalEntity;
  summary: string;
  payload: NewVersionPayload | CreatePayload;
}

export interface ToolOutcome {
  /** What the model is told. */
  text: string;
  /** Present when the call recorded a proposal for the user to apply. */
  proposal?: ProposalDraft;
  /** True when the text includes something the PIN hides -- the conversation is then hidden too. */
  touchedHidden?: boolean;
  /** Present for `update_notes`: the new working notes. */
  notes?: string;
  /** True when the call failed in a way the model should fix and retry. */
  isError?: boolean;
}

const LIST_CAP = 200;
const READ_ENTRY_CAP = 40;
const SEARCH_RESULTS = 12;
const SIMILAR_RESULTS = 15;

/** Text field limits, matching what the editors enforce (FIELD_LIMITS). */
const FIELD_LIMIT: Record<ProposalField, number> = {
  personality: FIELD_LIMITS.proseContent,
  dialogue: FIELD_LIMITS.proseContent,
  background: FIELD_LIMITS.proseContent,
  content: FIELD_LIMITS.scenarioContent,
  greeting: FIELD_LIMITS.greeting,
};

export const ASSISTANT_TOOLS: OllamaToolDefinition[] = [
  tool(
    'list_library',
    'List what is in the library: names with a one-line description. Use it to see what exists before reading or comparing.',
    {
      kind: {
        type: 'string',
        enum: ['all', 'characters', 'personas', 'scenarios', 'groups', 'books'],
        description: 'Which part of the library to list. Defaults to all.',
      },
    },
    []
  ),
  tool(
    'read_item',
    'Read one item in full: a character (personality, example dialogue, scenarios), a persona (background), a scenario (text and opening greeting), a group, or a lorebook (its entries). Always read an item before proposing a change to it.',
    {
      kind: { type: 'string', enum: ['character', 'persona', 'scenario', 'group', 'book'] },
      name: { type: 'string', description: 'The item\'s name (or id).' },
      owner: { type: 'string', description: 'For a scenario that shares its name with another: the character or group it belongs to.' },
    },
    ['kind', 'name']
  ),
  tool(
    'search_library',
    'Keyword search across names, descriptions, card text, scenarios and lorebook entries. Use it to find where something (a place, a person, a plot point) already appears.',
    { query: { type: 'string', description: 'Words to look for.' } },
    ['query']
  ),
  tool(
    'find_similar',
    'Find items whose text overlaps heavily (possible duplicates or near-copies). With a name, compares that item to the rest of its kind; without one, checks every pair. This compares shared vocabulary, so it finds copies, not paraphrases -- read the candidates to judge.',
    {
      kind: { type: 'string', enum: ['characters', 'personas', 'scenarios', 'books'], description: 'Required when no name is given.' },
      name: { type: 'string', description: 'Compare this one item against the others of its kind.' },
      threshold: { type: 'number', description: 'Minimum overlap 0.1-0.9 (default 0.3). Lower finds more.' },
    },
    []
  ),
  tool(
    'propose_new_version',
    'Propose new text for one field of an EXISTING character, persona or scenario. The user reviews a diff and decides; if applied it becomes a new version and the old text stays in the version history. Give the COMPLETE new text of the field, not a patch. Fields: character -> personality, dialogue; persona -> background; scenario -> content, greeting.',
    {
      entity: { type: 'string', enum: ['character', 'persona', 'scenario'] },
      name: { type: 'string', description: 'Name (or id) of the item to change.' },
      field: { type: 'string', enum: ['personality', 'dialogue', 'background', 'content', 'greeting'] },
      content: { type: 'string', description: 'The complete new text for that field.' },
      owner: { type: 'string', description: 'For a scenario: the character or group it belongs to, if the name alone is ambiguous.' },
      summary: { type: 'string', description: 'One short line: what changed and why.' },
    },
    ['entity', 'name', 'field', 'content']
  ),
  tool(
    'propose_create',
    'Propose a NEW character, persona or scenario. The user reviews it and decides. A scenario must name the character or group it belongs to. Fill the text fields that fit the entity: character -> personality, dialogue; persona -> background; scenario -> content, greeting.',
    {
      entity: { type: 'string', enum: ['character', 'persona', 'scenario'] },
      name: { type: 'string' },
      description: { type: 'string', description: 'A short blurb (one or two sentences).' },
      personality: { type: 'string' },
      dialogue: { type: 'string' },
      background: { type: 'string' },
      content: { type: 'string', description: 'Scenario text: the setting and situation.' },
      greeting: { type: 'string', description: 'Scenario opening greeting: the first message the character sends.' },
      owner: { type: 'string', description: 'Scenarios only: the character or group this scenario belongs to.' },
      summary: { type: 'string', description: 'One short line describing what this is.' },
    },
    ['entity', 'name']
  ),
  tool(
    'update_notes',
    'Replace the conversation\'s working notes: decisions made, the current direction, open questions. They are shown to you on every turn and survive when old messages are trimmed, so record what must not be forgotten. Keep them short; write the whole list, not an addition.',
    { notes: { type: 'string' } },
    ['notes']
  ),
];

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): OllamaToolDefinition {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

// --- argument helpers -------------------------------------------------------------------------

function text(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** Like `text` but keeps the model's line breaks and surrounding whitespace intact (card prose). */
function prose(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value.replace(/\r\n/g, '\n').trim() : undefined;
}

function fail(message: string): ToolOutcome {
  return { text: `Error: ${message}`, isError: true };
}

const ENTITIES: ProposalEntity[] = ['character', 'persona', 'scenario'];

// --- dispatch ---------------------------------------------------------------------------------

export function executeTool(name: string, args: Record<string, unknown>, lib: Library): ToolOutcome {
  switch (name) {
    case 'list_library':
      return listLibrary(args, lib);
    case 'read_item':
      return readItem(args, lib);
    case 'search_library':
      return searchLibrary(args, lib);
    case 'find_similar':
      return findSimilar(args, lib);
    case 'propose_new_version':
      return proposeNewVersion(args, lib);
    case 'propose_create':
      return proposeCreate(args, lib);
    case 'update_notes': {
      const notes = prose(args, 'notes') ?? '';
      return { text: notes ? 'Working notes updated.' : 'Working notes cleared.', notes };
    }
    default:
      return fail(
        `There is no tool called "${name}". The tools are: ${ASSISTANT_TOOLS.map((t) => t.function.name).join(', ')}.`
      );
  }
}

// --- list_library -----------------------------------------------------------------------------

function listLibrary(args: Record<string, unknown>, lib: Library): ToolOutcome {
  const kind = text(args, 'kind') ?? 'all';
  const sections: string[] = [];
  let touchedHidden = false;
  const mark = (hidden: boolean) => {
    if (hidden) touchedHidden = true;
  };

  const capped = <T>(items: T[]): { shown: T[]; more: string } => ({
    shown: items.slice(0, LIST_CAP),
    more: items.length > LIST_CAP ? `\n... and ${items.length - LIST_CAP} more (use search_library to find them)` : '',
  });

  if (kind === 'all' || kind === 'characters') {
    const { shown, more } = capped(lib.characters);
    shown.forEach((c) => mark(c.hidden));
    sections.push(
      `CHARACTERS (${lib.characters.length}):\n` +
        (shown.map((c) => `- ${c.name}${c.isQuick ? ' [quick]' : ''} -- ${oneLine(c.description) || '(no description)'}`).join('\n') || '(none)') +
        more
    );
  }
  if (kind === 'all' || kind === 'personas') {
    const { shown, more } = capped(lib.personas);
    shown.forEach((p) => mark(p.hidden));
    sections.push(
      `PERSONAS (${lib.personas.length}):\n` +
        (shown.map((p) => `- ${p.name} -- ${oneLine(p.description) || '(no description)'}`).join('\n') || '(none)') +
        more
    );
  }
  if (kind === 'all' || kind === 'scenarios') {
    const { shown, more } = capped(lib.scenarios);
    shown.forEach((s) => mark(s.hidden));
    sections.push(
      `SCENARIOS (${lib.scenarios.length}):\n` +
        (shown.map((s) => `- ${s.name} (${s.ownerKind}: ${s.ownerName}) -- ${oneLine(s.description) || '(no description)'}`).join('\n') || '(none)') +
        more
    );
  }
  if (kind === 'all' || kind === 'groups') {
    const { shown, more } = capped(lib.groups);
    shown.forEach((g) => mark(g.hidden));
    sections.push(
      `GROUPS (${lib.groups.length}):\n` +
        (shown.map((g) => `- ${g.name} (${g.members.join(', ')}) -- ${oneLine(g.description) || '(no description)'}`).join('\n') || '(none)') +
        more
    );
  }
  if (kind === 'all' || kind === 'books') {
    const { shown, more } = capped(lib.books);
    shown.forEach((b) => mark(b.hidden));
    sections.push(
      `LOREBOOKS (${lib.books.length}):\n` +
        (shown
          .map((b) => `- ${b.name} (${b.scope === 'personal' ? `personal history of ${b.ownerName}` : 'world'}, ${b.entries.length} entries)`)
          .join('\n') || '(none)') +
        more
    );
  }
  if (sections.length === 0) return fail(`Unknown kind "${kind}". Use all, characters, personas, scenarios, groups or books.`);
  return { text: sections.join('\n\n'), touchedHidden };
}

// --- read_item --------------------------------------------------------------------------------

function readItem(args: Record<string, unknown>, lib: Library): ToolOutcome {
  const kind = text(args, 'kind');
  const name = text(args, 'name') ?? '';
  const owner = text(args, 'owner');

  switch (kind) {
    case 'character': {
      const found = resolveOne(lib.characters, name, (c) => c.name, (c) => c.id, 'character');
      if ('error' in found) return fail(found.error);
      return { text: renderCharacter(found.item, lib), touchedHidden: found.item.hidden || undefined };
    }
    case 'persona': {
      const found = resolveOne(lib.personas, name, (p) => p.name, (p) => p.id, 'persona');
      if ('error' in found) return fail(found.error);
      return { text: renderPersona(found.item), touchedHidden: found.item.hidden || undefined };
    }
    case 'scenario': {
      const found = resolveScenario(lib, name, owner);
      if ('error' in found) return fail(found.error);
      return { text: renderScenario(found.item), touchedHidden: found.item.hidden || undefined };
    }
    case 'group': {
      const found = resolveOne(lib.groups, name, (g) => g.name, (g) => g.id, 'group');
      if ('error' in found) return fail(found.error);
      const g = found.item;
      const scenarios = lib.scenarios.filter((s) => s.ownerKind === 'group' && s.ownerId === g.id);
      return {
        text:
          `GROUP: ${g.name}\nMembers: ${g.members.join(', ')}\nDescription: ${g.description || '(none)'}\n` +
          `Group instructions: ${g.instructions || '(none)'}\n` +
          `Scenarios (${scenarios.length}):\n${scenarios.map((s) => `- ${s.name} -- ${oneLine(s.description)}`).join('\n') || '(none)'}`,
        touchedHidden: g.hidden || undefined,
      };
    }
    case 'book': {
      const found = resolveOne(lib.books, name, (b) => b.name, (b) => b.id, 'lorebook');
      if ('error' in found) return fail(found.error);
      return { text: renderBook(found.item), touchedHidden: found.item.hidden || undefined };
    }
    default:
      return fail('kind must be one of: character, persona, scenario, group, book.');
  }
}

function renderCharacter(c: LibCharacter, lib: Library): string {
  const scenarios = lib.scenarios.filter((s) => s.ownerKind === 'character' && s.ownerId === c.id);
  const groups = lib.groups.filter((g) => g.members.includes(c.name));
  return [
    `CHARACTER: ${c.name}${c.isQuick ? ' [quick character]' : ''}`,
    `Description: ${c.description || '(none)'}`,
    `Personality (${c.personality.length} chars):\n${c.personality || '(empty)'}`,
    `Example dialogue (${c.dialogue.length} chars):\n${c.dialogue || '(empty)'}`,
    `Scenarios (${scenarios.length}):\n${scenarios.map((s) => `- ${s.name} -- ${oneLine(s.description)}`).join('\n') || '(none)'}`,
    `World books attached: ${c.worldBooks.join(', ') || '(none)'}`,
    `In groups: ${groups.map((g) => g.name).join(', ') || '(none)'}`,
  ].join('\n');
}

function renderPersona(p: LibPersona): string {
  return [
    `PERSONA: ${p.name}`,
    `Description: ${p.description || '(none)'}`,
    `Background (${p.background.length} chars):\n${p.background || '(empty)'}`,
  ].join('\n');
}

function renderScenario(s: LibScenario): string {
  return [
    `SCENARIO: ${s.name} (belongs to ${s.ownerKind} ${s.ownerName})`,
    `Description: ${s.description || '(none)'}`,
    `Scenario text (${s.content.length} chars):\n${s.content || '(empty)'}`,
    `Opening greeting (${s.greeting.length} chars):\n${s.greeting || '(empty)'}`,
  ].join('\n');
}

function renderBook(b: LibBook): string {
  const shown = b.entries.slice(0, READ_ENTRY_CAP);
  const lines = shown.map(
    (e) => `- ${e.title}${e.keys ? ` [keys: ${e.keys}]` : ''}: ${clip(e.content.replace(/\s+/g, ' '), 400)}`
  );
  return [
    `LOREBOOK: ${b.name} (${b.scope === 'personal' ? `personal history of ${b.ownerName}` : 'world book'})`,
    `Description: ${b.description || '(none)'}`,
    `Entries (${b.entries.length}):\n${lines.join('\n') || '(none)'}${
      b.entries.length > shown.length ? `\n... and ${b.entries.length - shown.length} more entries not shown` : ''
    }`,
  ].join('\n');
}

function resolveScenario(lib: Library, name: string, owner?: string) {
  const pool = owner
    ? lib.scenarios.filter((s) => s.ownerName.toLowerCase() === owner.toLowerCase() || s.ownerId === owner)
    : lib.scenarios;
  if (owner && pool.length === 0) return { error: `No scenario belongs to "${owner}".` } as const;
  return resolveOne(pool, name, (s) => s.name, (s) => s.id, 'scenario');
}

// --- search_library ---------------------------------------------------------------------------

interface SearchDoc {
  label: string;
  field: string;
  text: string;
  hidden: boolean;
}

function searchDocs(lib: Library): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const c of lib.characters) {
    for (const [field, body] of [['description', c.description], ['personality', c.personality], ['dialogue', c.dialogue]] as const) {
      docs.push({ label: `character "${c.name}"`, field, text: `${c.name} ${body}`, hidden: c.hidden });
    }
  }
  for (const p of lib.personas) {
    docs.push({ label: `persona "${p.name}"`, field: 'description', text: `${p.name} ${p.description}`, hidden: p.hidden });
    docs.push({ label: `persona "${p.name}"`, field: 'background', text: `${p.name} ${p.background}`, hidden: p.hidden });
  }
  for (const s of lib.scenarios) {
    const label = `scenario "${s.name}" (${s.ownerName})`;
    for (const [field, body] of [['description', s.description], ['text', s.content], ['greeting', s.greeting]] as const) {
      docs.push({ label, field, text: `${s.name} ${body}`, hidden: s.hidden });
    }
  }
  for (const g of lib.groups) {
    docs.push({ label: `group "${g.name}"`, field: 'description/instructions', text: `${g.name} ${g.description} ${g.instructions}`, hidden: g.hidden });
  }
  for (const b of lib.books) {
    for (const e of b.entries) {
      docs.push({ label: `lorebook "${b.name}" entry "${e.title}"`, field: 'entry', text: `${e.title} ${e.keys} ${e.content}`, hidden: b.hidden });
    }
  }
  return docs;
}

function searchLibrary(args: Record<string, unknown>, lib: Library): ToolOutcome {
  const query = text(args, 'query');
  if (!query) return fail('Give some words to search for.');
  const words = queryWords(query);
  if (words.length === 0) return fail('The query has no searchable words.');

  const scored = searchDocs(lib)
    .map((doc) => ({ doc, score: keywordScore(doc.text, words) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);

  // One line per item: its best-matching field.
  const seen = new Set<string>();
  const hits: typeof scored = [];
  for (const hit of scored) {
    if (seen.has(hit.doc.label)) continue;
    seen.add(hit.doc.label);
    hits.push(hit);
    if (hits.length >= SEARCH_RESULTS) break;
  }
  if (hits.length === 0) return { text: `Nothing in the library matches "${query}".` };

  return {
    text:
      `Top ${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query}" (best-matching field shown):\n` +
      hits.map((h) => `- ${h.doc.label}, ${h.doc.field}: ${snippetAround(h.doc.text, words.find((w) => h.doc.text.toLowerCase().includes(w)) ?? words[0])}`).join('\n'),
    touchedHidden: hits.some((h) => h.doc.hidden) || undefined,
  };
}

// --- find_similar -----------------------------------------------------------------------------

interface SimilarItem {
  id: string;
  kind: string;
  name: string;
  owner: string | null;
  words: Set<string>;
  hidden: boolean;
}

function similarItems(lib: Library, kind: string): SimilarItem[] {
  const make = (id: string, k: string, name: string, owner: string | null, body: string, hidden: boolean): SimilarItem => ({
    id,
    kind: k,
    name,
    owner,
    words: contentWords(`${name} ${body}`),
    hidden,
  });
  switch (kind) {
    case 'characters':
      return lib.characters.map((c) => make(c.id, 'character', c.name, null, `${c.description} ${c.personality} ${c.dialogue}`, c.hidden));
    case 'personas':
      return lib.personas.map((p) => make(p.id, 'persona', p.name, null, `${p.description} ${p.background}`, p.hidden));
    case 'scenarios':
      return lib.scenarios.map((s) => make(s.id, 'scenario', s.name, s.ownerName, `${s.description} ${s.content} ${s.greeting}`, s.hidden));
    case 'books':
      return lib.books.map((b) => make(b.id, 'lorebook', b.name, b.ownerName, `${b.description} ${b.entries.map((e) => `${e.title} ${e.content}`).join(' ')}`, b.hidden));
    default:
      return [];
  }
}

const KIND_OF_SINGULAR: Record<string, string> = {
  character: 'characters',
  persona: 'personas',
  scenario: 'scenarios',
  lorebook: 'books',
};

function label(item: SimilarItem): string {
  return `${item.kind} "${item.name}"${item.owner ? ` (${item.owner})` : ''}`;
}

function findSimilar(args: Record<string, unknown>, lib: Library): ToolOutcome {
  const name = text(args, 'name');
  const kindArg = text(args, 'kind');
  const raw = typeof args.threshold === 'number' ? args.threshold : Number(args.threshold);
  const threshold = Number.isFinite(raw) ? Math.min(0.9, Math.max(0.1, raw)) : 0.3;

  let pairs: { a: SimilarItem; b: SimilarItem; score: number; sameName: boolean }[] = [];
  const compare = (a: SimilarItem, b: SimilarItem) => {
    const sameName = a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
    // Two cards with the same name are a duplicate candidate even when their text diverged.
    const score = Math.max(jaccard(a.words, b.words), sameName ? 0.6 : 0);
    if (score >= threshold) pairs.push({ a, b, score, sameName });
  };

  if (name) {
    const kinds = kindArg ? [kindArg] : ['characters', 'personas', 'scenarios', 'books'];
    const everything = kinds.flatMap((k) => similarItems(lib, k));
    const found = resolveOne(everything, name, (i) => i.name, (i) => i.id, 'item');
    if ('error' in found) return fail(found.error);
    const target = found.item;
    for (const other of similarItems(lib, KIND_OF_SINGULAR[target.kind] ?? '')) {
      if (other.id !== target.id) compare(target, other);
    }
  } else {
    if (!kindArg || !['characters', 'personas', 'scenarios', 'books'].includes(kindArg)) {
      return fail('Give a kind (characters, personas, scenarios or books), or the name of one item to compare.');
    }
    const items = similarItems(lib, kindArg);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) compare(items[i], items[j]);
  }

  pairs = pairs.sort((x, y) => y.score - x.score).slice(0, SIMILAR_RESULTS);
  if (pairs.length === 0) {
    return { text: `No pairs overlap at or above ${threshold.toFixed(2)}. (This compares shared vocabulary; paraphrased copies will not show.)` };
  }
  const lines = pairs.map(({ a, b, score, sameName }) => {
    const shared = [...a.words].filter((w) => b.words.has(w)).sort((p, q) => q.length - p.length).slice(0, 8);
    return `- ${score.toFixed(2)}  ${label(a)}  ~  ${label(b)}${sameName ? '  [same name]' : ''}  shared: ${shared.join(', ') || '(name only)'}`;
  });
  return {
    text: `Possible duplicates / overlaps (1.00 = identical vocabulary). Read the candidates before concluding anything:\n${lines.join('\n')}`,
    touchedHidden: pairs.some((p) => p.a.hidden || p.b.hidden) || undefined,
  };
}

// --- propose_* --------------------------------------------------------------------------------

function parseEntity(args: Record<string, unknown>): ProposalEntity | { error: string } {
  const entity = text(args, 'entity');
  return ENTITIES.includes(entity as ProposalEntity)
    ? (entity as ProposalEntity)
    : { error: 'entity must be one of: character, persona, scenario.' };
}

function proposeNewVersion(args: Record<string, unknown>, lib: Library): ToolOutcome {
  const entity = parseEntity(args);
  if (typeof entity !== 'string') return fail(entity.error);

  const field = text(args, 'field') as ProposalField | undefined;
  if (!field || !FIELDS_BY_ENTITY[entity].includes(field)) {
    return fail(`A ${entity} has these fields: ${FIELDS_BY_ENTITY[entity].join(', ')}.`);
  }
  const content = prose(args, 'content');
  if (!content) return fail('content is required: give the complete new text for the field.');
  if (content.length > FIELD_LIMIT[field]) {
    return fail(
      `The ${PROPOSAL_FIELD_LABELS[field]} is limited to ${FIELD_LIMIT[field].toLocaleString()} characters and this is ${content.length.toLocaleString()}. Shorten it and call again.`
    );
  }

  const name = text(args, 'name') ?? '';
  let entityId: string;
  let entityName: string;
  let before: string;
  let hidden: boolean;

  if (entity === 'character') {
    const found = resolveOne(lib.characters, name, (c) => c.name, (c) => c.id, 'character');
    if ('error' in found) return fail(found.error);
    ({ id: entityId, name: entityName, hidden } = found.item);
    before = field === 'personality' ? found.item.personality : found.item.dialogue;
  } else if (entity === 'persona') {
    const found = resolveOne(lib.personas, name, (p) => p.name, (p) => p.id, 'persona');
    if ('error' in found) return fail(found.error);
    ({ id: entityId, name: entityName, hidden } = found.item);
    before = found.item.background;
  } else {
    const found = resolveScenario(lib, name, text(args, 'owner'));
    if ('error' in found) return fail(found.error);
    ({ id: entityId, name: entityName, hidden } = found.item);
    before = field === 'greeting' ? found.item.greeting : found.item.content;
  }

  if (content === before.trim()) return fail('That text is identical to the current version, so there is nothing to propose.');

  const summary = oneLine(text(args, 'summary'), 160) || `New ${PROPOSAL_FIELD_LABELS[field].toLowerCase()} for ${entityName}`;
  return {
    text:
      `Proposal recorded: new ${PROPOSAL_FIELD_LABELS[field]} for ${entity} "${entityName}". ` +
      `It is NOT applied yet -- the user must review the diff and click Apply. Do not tell them it is done.`,
    proposal: { action: 'newVersion', entity, summary, payload: { entity, entityId, entityName, field, before, after: content } },
    touchedHidden: hidden || undefined,
  };
}

function proposeCreate(args: Record<string, unknown>, lib: Library): ToolOutcome {
  const entity = parseEntity(args);
  if (typeof entity !== 'string') return fail(entity.error);

  const name = text(args, 'name');
  if (!name) return fail('name is required.');
  if (name.length > FIELD_LIMITS.name) return fail(`The name is limited to ${FIELD_LIMITS.name} characters.`);
  const description = text(args, 'description') ?? '';
  if (description.length > FIELD_LIMITS.short) return fail(`The description is limited to ${FIELD_LIMITS.short} characters; shorten it.`);

  const fields: Partial<Record<ProposalField, string>> = {};
  const allFields: ProposalField[] = ['personality', 'dialogue', 'background', 'content', 'greeting'];
  for (const field of allFields) {
    const value = prose(args, field);
    if (value === undefined) continue;
    if (!FIELDS_BY_ENTITY[entity].includes(field)) {
      return fail(`A ${entity} has these text fields: ${FIELDS_BY_ENTITY[entity].join(', ')}. Remove "${field}".`);
    }
    if (value.length > FIELD_LIMIT[field]) {
      return fail(`The ${PROPOSAL_FIELD_LABELS[field]} is limited to ${FIELD_LIMIT[field].toLocaleString()} characters and this is ${value.length.toLocaleString()}. Shorten it and call again.`);
    }
    fields[field] = value;
  }

  const lower = name.toLowerCase();
  const payload: CreatePayload = { entity, name, description, fields };
  let hidden = false;

  if (entity === 'character') {
    if (lib.characters.some((c) => c.name.toLowerCase() === lower)) {
      return fail(`A character named "${name}" already exists. Read it and use propose_new_version, or choose a different name.`);
    }
  } else if (entity === 'persona') {
    if (lib.personas.some((p) => p.name.toLowerCase() === lower)) {
      return fail(`A persona named "${name}" already exists (persona names must be unique). Choose a different name or use propose_new_version.`);
    }
  } else {
    const owner = text(args, 'owner');
    if (!owner) return fail('A scenario belongs to a character or a group: give owner.');
    const ownerLower = owner.toLowerCase();
    const characters = lib.characters.filter((c) => c.name.toLowerCase() === ownerLower || c.id === owner);
    const groups = lib.groups.filter((g) => g.name.toLowerCase() === ownerLower || g.id === owner);
    if (characters.length + groups.length === 0) return fail(`No character or group named "${owner}". Use list_library to see the names.`);
    if (characters.length + groups.length > 1) return fail(`"${owner}" matches more than one character or group. Pass the id as owner.`);
    if (characters.length === 1) {
      payload.ownerCharacterId = characters[0].id;
      payload.ownerName = characters[0].name;
      hidden = characters[0].hidden;
    } else {
      payload.ownerGroupId = groups[0].id;
      payload.ownerName = groups[0].name;
      hidden = groups[0].hidden;
    }
    if (lib.scenarios.some((s) => s.ownerId === (payload.ownerCharacterId ?? payload.ownerGroupId) && s.name.toLowerCase() === lower)) {
      return fail(`${payload.ownerName} already has a scenario named "${name}".`);
    }
  }

  const summary = oneLine(text(args, 'summary'), 160) || `New ${entity}: ${name}`;
  return {
    text:
      `Proposal recorded: new ${entity} "${name}". It is NOT created yet -- the user must review it and click Apply. ` +
      `Do not tell them it is done.`,
    proposal: { action: 'create', entity, summary, payload },
    touchedHidden: hidden || undefined,
  };
}
