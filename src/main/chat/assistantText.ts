/**
 * Pure text helpers for the library assistant's tools -- no database, no model -- so they can be
 * tested directly and so the tools themselves stay about "what to look up" rather than string work.
 */

/** Words that say nothing about WHO a card is about, so two unrelated cards that both say "she was
 * the one who" do not look alike. Deliberately short: a long list starts deleting real content. */
const STOP_WORDS = new Set(
  (
    'a an and are as at be been but by for from had has have he her hers him his i if in into is it its ' +
    'me my not of on or our out she so than that the their them then there they this those to was we were ' +
    'what when where which who will with you your char user'
  ).split(' ')
);

/** Lower-cased content words of a text (3+ letters, not a stop word). */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z0-9À-ɏ']+/g)) {
    const word = match[0].replace(/^'+|'+$/g, '');
    if (word.length >= 3 && !STOP_WORDS.has(word)) words.add(word);
  }
  return words;
}

/** Jaccard overlap of two word sets, 0..1. Empty on either side is 0, never NaN. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const word of small) if (large.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

/** How alike two pieces of text are by shared vocabulary. This is lexical: it finds copies and
 * near-copies, and misses a paraphrase that uses different words. */
export function similarity(textA: string, textB: string): number {
  return jaccard(contentWords(textA), contentWords(textB));
}

/** Cuts text to `max` characters on a word boundary and says how much was left out. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const body = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${body}... [${text.length - body.length} more characters not shown]`;
}

/** A single line of the text, for lists: newlines collapsed, clipped. */
export function oneLine(text: string | null | undefined, max = 110): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The part of `text` around the first occurrence of `needle`, for search results. */
export function snippetAround(text: string, needle: string, radius = 70): string {
  const flat = text.replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return oneLine(flat, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + needle.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

export type Resolution<T> = { item: T } | { error: string };

/**
 * Finds one item by id or name for a tool. Local models rarely have ids to hand and names are what
 * the user speaks in, so a name is the normal route: exact (case-insensitive) first, then a unique
 * partial match. More than one match is an error that lists the candidates WITH their ids, so the
 * model can retry with the id instead of guessing.
 */
export function resolveOne<T>(
  items: T[],
  query: string,
  nameOf: (item: T) => string,
  idOf: (item: T) => string,
  kind: string
): Resolution<T> {
  const needle = query.trim();
  if (!needle) return { error: `Give the ${kind}'s name.` };

  const byId = items.find((item) => idOf(item) === needle);
  if (byId) return { item: byId };

  const lower = needle.toLowerCase();
  const exact = items.filter((item) => nameOf(item).trim().toLowerCase() === lower);
  if (exact.length === 1) return { item: exact[0] };
  if (exact.length > 1) return { error: ambiguous(kind, needle, exact, nameOf, idOf) };

  const partial = items.filter((item) => nameOf(item).toLowerCase().includes(lower));
  if (partial.length === 1) return { item: partial[0] };
  if (partial.length > 1) return { error: ambiguous(kind, needle, partial, nameOf, idOf) };

  return { error: `No ${kind} named "${needle}". Use list_library to see the exact names.` };
}

function ambiguous<T>(kind: string, needle: string, matches: T[], nameOf: (t: T) => string, idOf: (t: T) => string): string {
  const shown = matches.slice(0, 8).map((item) => `"${nameOf(item)}" (id ${idOf(item)})`);
  return `More than one ${kind} matches "${needle}": ${shown.join('; ')}. Repeat the call with the id as the name.`;
}

/** Keyword search score: how many of the query's words appear in the text (0 when none do). */
export function keywordScore(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of words) if (word && lower.includes(word)) score++;
  return score;
}

/** Splits a search query into lower-cased words worth matching. */
export function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9À-ɏ']+/)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}
