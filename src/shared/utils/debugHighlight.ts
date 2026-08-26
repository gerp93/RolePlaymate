/**
 * Segmenters for the Prompt Debug Console.
 *
 * Pure functions returning `{ text, kind }` runs, so the React layer only maps kinds to CSS
 * classes and the parsing itself is directly testable. Ported from the span builders in
 * KVGenius's desktop_app.py, with the colours left to CSS -- this app has 14 themes, so
 * hardcoding Material colours the way the source did would look wrong in most of them.
 */

export type SegmentKind =
  | 'text'
  /** A [BRACKET TAG] delimiter. */
  | 'tag'
  /** Content inside a [SYSTEM] block of the rendered request. */
  | 'system'
  /** Content inside a [USER] block. */
  | 'user'
  /** Content inside an [ASSISTANT] block. */
  | 'assistant';

export interface Segment {
  text: string;
  kind: SegmentKind;
}

/** Matches the section delimiters the prompt templates use: [CHARACTER], [/USER PERSONA]. */
const BRACKET_TAG = /(\[\/?[A-Z][A-Z _/]*\])/g;

/** Splits a prompt section so its [BRACKET TAGS] can be dimmed away from the content. */
export function highlightBracketTags(text: string): Segment[] {
  if (!text) return [];
  return text
    .split(BRACKET_TAG)
    .filter((part) => part !== '')
    .map((part) => ({
      text: part,
      kind: /^\[\/?[A-Z][A-Z _/]*\]$/.test(part) ? ('tag' as const) : ('text' as const),
    }));
}

/**
 * Colour-codes the fully rendered request by whose turn each block is.
 *
 * The source split on `[INST]` / `[/INST]` / `</s>` -- Mistral raw-prompt tags. Its own
 * refactor then changed the debug rendering to emit `[SYSTEM]` / `[USER]` / `[ASSISTANT]`
 * blocks instead, so that splitter stopped matching anything: the section rendered flat and
 * the System/User/LLM colour key in the header described colours that were not on screen.
 * This matches the format actually produced (see renderMessagesForDebug).
 */
export function highlightRoleBlocks(text: string): Segment[] {
  if (!text) return [];

  const ROLE_HEADER = /^\[(SYSTEM|USER|ASSISTANT)\]$/;
  const kindForRole: Record<string, SegmentKind> = {
    SYSTEM: 'system',
    USER: 'user',
    ASSISTANT: 'assistant',
  };

  const segments: Segment[] = [];
  let current: SegmentKind = 'text';

  for (const line of text.split('\n')) {
    const header = line.trim().match(ROLE_HEADER);
    if (header) {
      current = kindForRole[header[1]];
      segments.push({ text: line, kind: 'tag' });
    } else {
      segments.push({ text: line, kind: current });
    }
    segments.push({ text: '\n', kind: 'text' });
  }

  segments.pop(); // trailing newline added by the loop
  return segments;
}

/**
 * Renders a stop phrase so its whitespace is visible.
 *
 * Stop phrases are mostly `"\nUser:"`-shaped, and the leading newline is the whole point of
 * them -- a bare `"User:"` also fires mid-sentence. Printing them raw would show a blank
 * line and hide the very character that matters, so they are quoted and escaped.
 */
export function formatStopPhrase(phrase: string): string {
  return JSON.stringify(phrase);
}

/** A prior turn as the debug console lists it. */
export interface DebugHistoryTurn {
  role: string;
  content: string;
}

export interface DebugHistoryEntry {
  turn: number;
  role: string;
  content: string;
}

/**
 * Numbers prior turns for display, truncating long assistant replies.
 *
 * The source flattened history to a string and then re-parsed it with a regex to colour the
 * roles back in. The structured array is right here, so this numbers turns and leaves
 * rendering to React -- no parse to get wrong.
 */
export function buildHistoryEntries(
  turns: DebugHistoryTurn[],
  maxContentLength = 300
): DebugHistoryEntry[] {
  const entries: DebugHistoryEntry[] = [];
  let turnNumber = 0;

  for (const turn of turns) {
    if (turn.role === 'user') turnNumber += 1;
    const content =
      turn.content.length > maxContentLength
        ? `${turn.content.slice(0, maxContentLength)}...`
        : turn.content;
    entries.push({ turn: Math.max(turnNumber, 1), role: turn.role, content });
  }

  return entries;
}
