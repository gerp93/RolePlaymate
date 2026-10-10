/**
 * Catches a model leaning on the same wording, and a scene that has stopped moving.
 *
 * The near-duplicate guard (automationRunner's isRepeat) only sees a reply that is almost word for word
 * an earlier one. A roleplay model's habit is different: new sentences, each stuffed with the same stock
 * phrases ("my heart pounding in my chest", "my voice low and urgent"), the same opening, the same
 * gesture. No single reply repeats another, so nothing trips - yet over a long run those few phrases
 * turn up in half of all replies. These helpers find them from the speaker's own recent replies so the
 * prompt can say, right where the model is about to write, "you have been using these - don't".
 *
 * Plain text processing, no model, and nothing specific to any story or character.
 */

/** Words that carry no content on their own; a phrase made only of these is not a stock phrase. */
const FUNCTION_WORDS = new Set(
  (
    'a an the and or but if so as at by for in of on to up out off with from into onto over under about ' +
    'is are was were be been being am do does did have has had having will would can could shall should may might must ' +
    'i me my mine myself you your yours yourself he him his she her hers it its we us our they them their ' +
    'this that these those there here then than not no yes just very too also still even ever never ' +
    'what when where which who whom whose why how all any some each both more most other such own same'
  ).split(' ')
);

export interface OverusedPhrases {
  /** Word sequences (lower case, in the order written) found in several of the recent replies. */
  phrases: string[];
  /** Opening words that several recent replies began with. */
  openings: string[];
}

export interface OverusedOptions {
  /** How many of the most recent replies are looked at. */
  window?: number;
  /** A phrase must turn up in at least this many different replies. */
  minReplies?: number;
  /** Shortest and longest phrase, in words. */
  minWords?: number;
  maxWords?: number;
  /** Most phrases returned. */
  limit?: number;
  /** How many opening words count as "the same opening", and how many recent replies are checked. */
  openingWords?: number;
  openingWindow?: number;
  openingMinReplies?: number;
}

const DEFAULTS: Required<OverusedOptions> = {
  window: 12,
  minReplies: 3,
  minWords: 3,
  maxWords: 7,
  limit: 5,
  openingWords: 3,
  openingWindow: 8,
  openingMinReplies: 3,
};

/** A reply as plain words: formatting marks and punctuation gone, lower case, contractions kept whole. */
export function plainWords(text: string): string[] {
  return (text.toLowerCase().replace(/[*_~`"“”]/g, ' ').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).map((w) =>
    w.replace(/’/g, "'")
  );
}

function contentWordCount(words: string[]): number {
  return words.filter((w) => !FUNCTION_WORDS.has(w)).length;
}

/**
 * The phrases and openings the speaker keeps coming back to, from their own recent `replies` (oldest
 * first). A phrase is a run of 3 to 7 words, with at least two content words, that appears in several
 * different replies; where a longer phrase contains a shorter one only the longer is kept.
 */
export function findOverusedPhrases(
  replies: string[],
  options: OverusedOptions = {},
  /** The other speakers' recent lines. A phrase they use too is the scene's vocabulary ("the reactor
   * core"), not this speaker's habit, and is left alone. */
  others: string[] = []
): OverusedPhrases {
  const o = { ...DEFAULTS, ...options };
  const recent = replies.slice(-o.window).map(plainWords).filter((w) => w.length > 0);
  const theirs = others.slice(-o.window).map((text) => ` ${plainWords(text).join(' ')} `);
  const sharedWithOthers = (phrase: string): boolean =>
    theirs.filter((line) => line.includes(` ${phrase} `)).length >= 2;

  // Phrase -> the replies (by index) it appears in.
  const seen = new Map<string, Set<number>>();
  recent.forEach((words, index) => {
    for (let n = o.minWords; n <= o.maxWords; n += 1) {
      for (let start = 0; start + n <= words.length; start += 1) {
        const gram = words.slice(start, start + n);
        // Starting or ending on a function word ("of facing whatever", "in my chest and") just makes a
        // phrase longer than its stock core; the trimmed version is found on its own.
        if (FUNCTION_WORDS.has(gram[0]!) && n > o.minWords) continue;
        if (contentWordCount(gram) < 2) continue;
        const key = gram.join(' ');
        const where = seen.get(key) ?? new Set<number>();
        where.add(index);
        seen.set(key, where);
      }
    }
  });

  const repeated = [...seen.entries()]
    .filter(([phrase, where]) => where.size >= o.minReplies && !sharedWithOthers(phrase))
    .map(([phrase, where]) => ({ phrase, count: where.size, length: phrase.split(' ').length }))
    // Most-used first, then longest (the longest version of a stock phrase is the clearest to name).
    .sort((a, b) => b.count - a.count || b.length - a.length);

  const picked: typeof repeated = [];
  for (const candidate of repeated) {
    // Contained in one already chosen: that one already says it.
    if (picked.some((p) => p.phrase.includes(candidate.phrase))) continue;
    // Contains one already chosen and is nearly as common: it is the same habit with more of its words
    // (the shorter core turns up in other sentences too), and the fuller phrase is the clearer to quote.
    const core = picked.findIndex((p) => candidate.phrase.includes(p.phrase) && candidate.count >= p.count * 0.7);
    if (core >= 0) {
      picked[core] = candidate;
      continue;
    }
    // Built mostly from the content words of one already chosen ("my heart pounding" beside "heart pounding
    // in my chest", or two ends of the same long phrase): the same habit again, not a second one.
    const words = candidate.phrase.split(' ').filter((w) => !FUNCTION_WORDS.has(w));
    const mostlyShared = (p: { phrase: string }) => {
      const theirs = new Set(p.phrase.split(' '));
      return words.filter((w) => theirs.has(w)).length / words.length >= 0.7;
    };
    if (picked.some(mostlyShared)) continue;
    if (picked.length < o.limit) picked.push(candidate);
  }

  const openings = new Map<string, number>();
  for (const words of recent.slice(-o.openingWindow)) {
    if (words.length < o.openingWords) continue;
    const opening = words.slice(0, o.openingWords).join(' ');
    openings.set(opening, (openings.get(opening) ?? 0) + 1);
  }

  return {
    phrases: picked.map((p) => p.phrase),
    openings: [...openings.entries()]
      .filter(([, count]) => count >= o.openingMinReplies)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([opening]) => opening),
  };
}

/**
 * Which of the flagged habits a finished reply fell back on anyway. Asking the model to avoid them is
 * only a request, and a roleplay model ignores it often enough (one run: "take a deep breath" in 43% of
 * replies with the request in every prompt), so a caller that can redo a reply uses this to decide to.
 * Returns the phrases found, and "<opening>..." for a flagged opening.
 */
export function overusedHits(text: string, found: OverusedPhrases | undefined, openingWords = DEFAULTS.openingWords): string[] {
  if (!hasOverused(found)) return [];
  const words = plainWords(text);
  const padded = ` ${words.join(' ')} `;
  const hits = found.phrases.filter((phrase) => padded.includes(` ${phrase} `));
  const opening = words.slice(0, openingWords).join(' ');
  for (const flagged of found.openings) if (flagged === opening) hits.push(`${flagged}...`);
  return hits;
}

/**
 * How much of a reply is wording it already used: the share of its `n`-word sequences that appear in
 * any of the `previous` replies. Word-set overlap misses a reply that says the same things in new
 * words order-for-order the same ("Your corruption ends now... before Haven's citizens... no more
 * secrets or lies from behind closed doors", ten times over); long shared sequences do not.
 * 0 when there is not enough text to tell.
 */
export function repeatedSequenceShare(text: string, previous: string[], n = 5): number {
  const sequences = (value: string): Set<string> => {
    const words = plainWords(value);
    const found = new Set<string>();
    for (let i = 0; i + n <= words.length; i += 1) found.add(words.slice(i, i + n).join(' '));
    return found;
  };
  const mine = sequences(text);
  if (mine.size === 0) return 0;
  const seen = new Set<string>();
  for (const earlier of previous) for (const sequence of sequences(earlier)) seen.add(sequence);
  let shared = 0;
  for (const sequence of mine) if (seen.has(sequence)) shared += 1;
  return shared / mine.size;
}

/** Whether there is anything to tell the model. */
export function hasOverused(found: OverusedPhrases | undefined): found is OverusedPhrases {
  return !!found && (found.phrases.length > 0 || found.openings.length > 0);
}

/**
 * The instruction for the end of the prompt. Quotes the phrases themselves: a model told only "vary your
 * wording" carries on exactly as before, but one shown the habit it is in can steer around it.
 */
export function describeOverused(found: OverusedPhrases | undefined): string {
  if (!hasOverused(found)) return '';
  const parts: string[] = [];
  if (found.phrases.length > 0) {
    parts.push(`phrases you have used again and again recently: ${found.phrases.map((p) => `"${p}"`).join(', ')}`);
  }
  if (found.openings.length > 0) {
    parts.push(`openings you keep starting with: ${found.openings.map((p) => `"${p}..."`).join(', ')}`);
  }
  return (
    `Variety: ${parts.join('; and ')}. Do not use them or close variations of them this time. ` +
    `Find fresh wording, a different gesture or reaction, and a different way to begin.`
  );
}

// ---- A scene that has stopped moving ---------------------------------------------------------------------

const STALL_BACK = 6;
const STALL_WINDOW = 4;
/** Mean share of a line's content words that are new, below which the scene is going in circles.
 * Measured on a 100-turn run: ordinary flow sits around 0.45, a stuck standoff around 0.30 and below. */
export const STALL_NOVELTY = 0.28;

function contentWords(text: string): Set<string> {
  return new Set(plainWords(text).filter((w) => w.length >= 4 && !FUNCTION_WORDS.has(w)));
}

/**
 * How much of each recent line is new: the share of its content words not used in the few lines before
 * it. A conversation that is going somewhere keeps bringing in new things; one that is circling reuses
 * the same words (the same room, the same standoff, the same worries) and this falls.
 */
export function noveltyOf(lines: string[], index: number, back: number = STALL_BACK): number {
  const current = contentWords(lines[index] ?? '');
  if (current.size === 0) return 1;
  const earlier = new Set<string>();
  for (let i = Math.max(0, index - back); i < index; i += 1) for (const w of contentWords(lines[i] ?? '')) earlier.add(w);
  let fresh = 0;
  for (const w of current) if (!earlier.has(w)) fresh += 1;
  return fresh / current.size;
}

/** True when the last few lines of the conversation (all speakers, oldest first) bring in little that is new. */
export function isStalled(lines: string[], threshold: number = STALL_NOVELTY): boolean {
  if (lines.length < STALL_BACK + STALL_WINDOW) return false;
  let total = 0;
  for (let i = lines.length - STALL_WINDOW; i < lines.length; i += 1) total += noveltyOf(lines, i);
  return total / STALL_WINDOW < threshold;
}

/** What to say to a character about to speak, when the scene is stalled. */
export const STALL_NUDGE =
  'The scene has been going in circles: the same situation and the same words. Change something now - ' +
  'a new development, a piece of new information, a decision, a new place, or someone or something arriving - ' +
  'rather than holding the moment or restating it.';
