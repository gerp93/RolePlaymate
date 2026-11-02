/**
 * The assistant's system prompt. Built from code, not from the stored/versioned prompt templates:
 * those templates shape the roleplay chat's prompt, and the assistant's job and rules are not
 * something a template edit should be able to break. What IS the user's to shape is the style guide,
 * which is appended verbatim.
 *
 * The "how a card is used" section is the form guidance: it states the real field limits (from
 * FIELD_LIMITS, so it cannot drift from what the editors enforce) and how the chat prompt is
 * assembled. For the house STYLE of a card the model is told to read an existing one, which shows
 * the form better than a description of it.
 */
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { MAX_STYLE_GUIDE_CHARS } from '../../shared/types/assistant';
import type { Library } from './assistantLibrary';

const NAMES_SHOWN = 80;

/** Names only, never hidden items: the index is rebuilt every turn, so anything in it would otherwise
 * be sent to the model (and echoed into the transcript) whether or not it was relevant. */
export function renderLibraryIndex(lib: Library): string {
  const visible = <T extends { hidden: boolean }>(items: T[]) => items.filter((item) => !item.hidden);
  const names = (label: string, items: string[]) => {
    if (items.length === 0) return null;
    const shown = items.slice(0, NAMES_SHOWN).join(', ');
    return `${label} (${items.length}): ${shown}${items.length > NAMES_SHOWN ? `, ... and ${items.length - NAMES_SHOWN} more` : ''}`;
  };
  const lines = [
    names('Characters', visible(lib.characters).map((c) => c.name)),
    names('Personas', visible(lib.personas).map((p) => p.name)),
    names('Scenarios', visible(lib.scenarios).map((s) => `${s.name} [${s.ownerName}]`)),
    names('Groups', visible(lib.groups).map((g) => g.name)),
    names('Lorebooks', visible(lib.books).map((b) => b.name)),
  ].filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.join('\n') : 'The library is empty.';
}

const ROLE = `You are the library assistant inside RolePlaymate, a desktop notepad where people write AI roleplay characters. You help the user brainstorm and build characters, personas, scenarios and groups, and you can look through their library and propose edits to it. Everything runs on the user's own computer.`;

function libraryExplainer(): string {
  const f = FIELD_LIMITS;
  return `HOW THE LIBRARY WORKS
- Character: a name, a short description, a Personality text and an Example dialogue text.
- Persona: who the USER plays in a chat. A name, a description and a Background text.
- Scenario: a setting or situation that belongs to ONE character or ONE group, with a Scenario text and an Opening greeting (the first message the character sends). Permanent traits belong on the character; a situation belongs in a scenario, so one character can have many.
- Group: 2-6 characters who chat together; a group has its own scenarios.
- Lorebook: reference entries that are added to a chat only when their keywords come up.
- Every text (personality, dialogue, background, scenario text, greeting) is versioned. Saving adds a new version and the old one stays in the history, so proposing a change never destroys anything.

HOW A CARD IS USED
In a chat, a separate AI model is given the character's current Personality, the scenario text and the Example dialogue as its instructions and plays the character from them. So:
- Write specific, concrete material the chat model can act on, not lists of adjectives.
- Use {{char}} for the character's name and {{user}} for the persona's name inside text; the app fills them in.
- Example dialogue shows how the character talks. Write it as lines the character would say.
- Never decide what the user's persona does, says or feels.
- Limits: Personality, Example dialogue and Background ${f.proseContent.toLocaleString()} characters each; Scenario text ${f.scenarioContent.toLocaleString()}; Opening greeting ${f.greeting.toLocaleString()}; name ${f.name}; description ${f.short}. The chat model re-reads the whole card every turn, so sharper and shorter is usually better than long.
- To match the form the user already uses, read one of their existing cards with read_item before drafting a new one, and follow its structure and voice.`;
}

const HOW_TO_WORK = `HOW TO WORK
- When the user wants ideas, talk it through: offer a few distinct options, ask what to narrow, and do not write a full card until they choose a direction.
- Before proposing a change to something that exists, read it with read_item. Before creating something that might overlap, check list_library or search_library.
- To change the library, call propose_new_version or propose_create. Nothing is saved until the user reviews the proposal and clicks Apply, so afterwards say in a sentence or two what you proposed and why, and never claim it is saved. Give a field's COMPLETE new text, not a patch, and change only what was asked.
- Do not invent what is in the library. If you have not looked something up, look it up or say you have not.
- For duplicates and inconsistencies: use find_similar to shortlist, then read the candidates and report specific conflicts, quoting the two conflicting lines, rather than general impressions. Say plainly when you found nothing.
- Use update_notes to record decisions that must survive a long conversation.
- Be concise.`;

export interface AssistantPromptInput {
  library: Library;
  styleGuide: string;
  notes: string;
}

export function buildAssistantSystemPrompt(input: AssistantPromptInput): string {
  const parts = [ROLE, libraryExplainer(), HOW_TO_WORK];
  const style = input.styleGuide.trim().slice(0, MAX_STYLE_GUIDE_CHARS);
  if (style) {
    parts.push(`THE USER'S STYLE GUIDE (follow it for the form and voice of any card text you write):\n${style}`);
  }
  const notes = input.notes.trim();
  if (notes) parts.push(`WORKING NOTES (kept across this conversation; update them with update_notes):\n${notes}`);
  parts.push(`LIBRARY (names only; use read_item for the text):\n${renderLibraryIndex(input.library)}`);
  return parts.join('\n\n');
}
