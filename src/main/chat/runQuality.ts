import { AutomationRunLog, AutomationTranscriptLine } from '../../shared/types/automation';
import { whyUnfit } from './memoryExtraction';
import { findOverusedPhrases, isStalled, plainWords } from './phraseGuard';

/**
 * The measurements a person would otherwise make by hand on a long run: is the model leaning on stock
 * phrases, did the story stop moving, did its opening threads get dropped, is one side doing all the
 * driving, are the memories any good. Plain text analysis of the log, nothing specific to any story, so
 * two runs (different models, settings, cards) can be compared by their numbers rather than by reading
 * a hundred turns twice. Rendered into the readable export (see automationExport.ts).
 */

const FUNCTION_WORDS = new Set(
  (
    'about above after again against also because been before being below between both could does doing down during each ' +
    'from further have having here into just more most other over same should some such than that their them then there ' +
    'these they this those through under until very were what when where which while will with would your yours ' +
    'said says like even still back only'
  ).split(' ')
);

const pct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '-');

/** Number of lines in which the phrase appears. */
function linesContaining(lines: string[], phrase: string): number {
  const needle = ` ${phrase} `;
  return lines.filter((text) => ` ${plainWords(text).join(' ')} `.includes(needle)).length;
}

function nameWords(log: AutomationRunLog): Set<string> {
  const names = new Set<string>();
  for (const name of [log.run.characterName, log.run.personaName]) for (const word of plainWords(name)) names.add(word);
  return names;
}

/** First-card section by tag, e.g. "EXAMPLE DIALOGUE", from the first turn's system prompt. */
function cardSection(prompt: string | null, tag: string): string | null {
  if (!prompt) return null;
  const match = new RegExp(`\\[${tag}\\]\\n([\\s\\S]*?)\\n\\[/${tag}\\]`).exec(prompt);
  return match ? match[1].trim() : null;
}

function firstPrompt(log: AutomationRunLog): string | null {
  const first = log.turns[0]?.debug;
  if (!first) return null;
  if (first.systemPrompt) return first.systemPrompt;
  const match = /^\[SYSTEM\]\n([\s\S]*?)\n\n\[(?:USER|ASSISTANT)\]\n/.exec(first.fullPrompt ?? '');
  return match ? match[1] : null;
}

/** Runs of consecutive indexes as "3-9, 14". */
function spans(indexes: number[]): string {
  const out: string[] = [];
  let start = -1;
  let prev = -2;
  for (const i of [...indexes, Number.POSITIVE_INFINITY]) {
    if (i !== prev + 1) {
      if (start >= 0) out.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = i;
    }
    prev = i;
  }
  return out.join(', ');
}

function bySpeaker(lines: AutomationTranscriptLine[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of lines) map.set(line.speaker, [...(map.get(line.speaker) ?? []), line.content]);
  return map;
}

/** The report, as markdown lines (no trailing blank line). */
export function renderQualityReport(log: AutomationRunLog): string[] {
  const out: string[] = ['## Run quality report', ''];
  const speakers = bySpeaker(log.transcript);
  const totalLines = log.transcript.length;
  if (totalLines < 8) {
    out.push('Too short to measure (fewer than 8 messages).');
    return out;
  }
  out.push(
    'Measured from the transcript and memory log, to compare runs by number. Phrase and name counts are word-based',
    'and approximate. A phrase the other side uses as well is the scene\'s vocabulary and is not counted as a habit.',
    ''
  );

  // ---- Length
  out.push('### Replies');
  out.push('');
  for (const [speaker, lines] of speakers) {
    const words = lines.map((t) => plainWords(t).length);
    const mean = Math.round(words.reduce((a, b) => a + b, 0) / words.length);
    out.push(`- ${speaker}: ${lines.length} messages, ${mean} words on average (shortest ${Math.min(...words)}, longest ${Math.max(...words)})`);
  }

  // ---- Stock phrases
  out.push('');
  out.push('### Stock phrases');
  out.push('');
  out.push('Wording a speaker leaned on, with how many of their messages used it. High shares mean the model is falling back on habit.');
  out.push('');
  for (const [speaker, lines] of speakers) {
    const others = totalLinesOf(speakers, speaker);
    const found = findOverusedPhrases(
      lines,
      { window: lines.length, minReplies: Math.max(4, Math.ceil(lines.length * 0.08)), maxWords: 8, limit: 8 },
      others
    );
    out.push(`**${speaker}**`);
    if (found.phrases.length === 0) out.push('- no phrase used in more than a few messages');
    for (const phrase of found.phrases) {
      const n = linesContaining(lines, phrase);
      out.push(`- "${phrase}": ${n} of ${lines.length} messages (${pct(n, lines.length)})`);
    }
    // Openings: several messages starting the same way.
    const openings = new Map<string, number>();
    for (const text of lines) {
      const words = plainWords(text);
      if (words.length >= 3) openings.set(words.slice(0, 3).join(' '), (openings.get(words.slice(0, 3).join(' ')) ?? 0) + 1);
    }
    const common = [...openings.entries()].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [opening, n] of common) out.push(`- begins "${opening}...": ${n} of ${lines.length} messages`);
    let sameAsPrevious = 0;
    for (let i = 1; i < lines.length; i += 1) {
      const a = plainWords(lines[i - 1]).slice(0, 3).join(' ');
      if (a && a === plainWords(lines[i]).slice(0, 3).join(' ')) sameAsPrevious += 1;
    }
    out.push(`- same first three words as their previous message: ${sameAsPrevious} times`);
    out.push('');
  }

  // ---- Stalls
  const texts = log.transcript.map((l) => l.content);
  const stalledAt: number[] = [];
  for (let n = 10; n <= texts.length; n += 1) if (isStalled(texts.slice(0, n))) stalledAt.push(n);
  out.push('### Stalls');
  out.push('');
  out.push(
    stalledAt.length === 0
      ? 'The scene kept bringing in new material throughout.'
      : `The scene went in circles (little new in the last few messages) at message${stalledAt.length > 1 ? 's' : ''} ${spans(stalledAt)}: ${stalledAt.length} of ${texts.length - 9} points along the run.`
  );

  // ---- Threads dropped
  const names = nameWords(log);
  const wordsOf = (t: string) => plainWords(t).filter((w) => w.length >= 5 && !FUNCTION_WORDS.has(w) && !names.has(w));
  const early = texts.slice(0, Math.max(4, Math.floor(texts.length * 0.15)));
  const late = texts.slice(Math.floor(texts.length * 0.4));
  const earlyCount = new Map<string, number>();
  for (const t of early) for (const w of new Set(wordsOf(t))) earlyCount.set(w, (earlyCount.get(w) ?? 0) + 1);
  const lateWords = new Set(late.flatMap(wordsOf));
  const dropped = [...earlyCount.entries()]
    .filter(([w, n]) => n >= 2 && !lateWords.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
  out.push('');
  out.push('### Opening threads');
  out.push('');
  out.push(
    dropped.length === 0
      ? 'Words that mattered early are still turning up later.'
      : `Words that came up repeatedly in the first 15% and never in the last 60%: ${dropped.join(', ')}. If these were the story's premise, it was dropped.`
  );

  // ---- Who drives
  out.push('');
  out.push('### Initiative');
  out.push('');
  const seenNames = new Set<string>();
  for (const [speaker, lines] of speakers) {
    const asks = lines.filter((t) => t.includes('?')).length;
    let introduced = 0;
    for (const t of lines) {
      const fresh = (t.match(/(?<=[a-z,;]\s)[A-Z][a-z]{3,}/g) ?? []).filter((w) => !seenNames.has(w) && !names.has(w.toLowerCase()));
      if (fresh.length > 0) introduced += 1;
      for (const w of t.match(/\b[A-Z][a-z]{3,}\b/g) ?? []) seenNames.add(w);
    }
    out.push(`- ${speaker}: asks a question in ${pct(asks, lines.length)} of messages, brings in a new name in ${pct(introduced, lines.length)}`);
  }

  // ---- Memory
  out.push('');
  out.push('### Memory');
  out.push('');
  const pools = log.turns.map((t) => t.debug.retrieval?.totalAvailable ?? 0);
  if (pools.some((n) => n > 0)) {
    out.push(`- Stored memories: ${pools[Math.floor(pools.length / 2)]} by the middle of the run, ${pools[pools.length - 1]} at the end.`);
  }
  const injectedTurns = new Map<string, number>();
  const kinds = new Map<string, string>();
  for (const turn of log.turns) {
    for (const entry of turn.debug.retrieval?.selected ?? []) {
      const text = entry.memory.content;
      injectedTurns.set(text, (injectedTurns.get(text) ?? 0) + 1);
      kinds.set(text, whyUnfit(text) ?? 'fact');
    }
  }
  const stuck = [...injectedTurns.entries()]
    .filter(([, n]) => n >= Math.max(5, Math.ceil(log.turns.length * 0.2)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (stuck.length === 0) out.push('- No memory sat in the prompt for more than a fifth of the run.');
  for (const [text, n] of stuck) out.push(`- Injected into ${n} of ${log.turns.length} turns: ${text}`);
  const distinct = [...kinds.values()];
  if (distinct.length > 0) {
    const bad = distinct.filter((k) => k !== 'fact').length;
    const reasons = (['second person', 'commentary', 'momentary', 'feeling'] as const)
      .map((r) => [r, distinct.filter((k) => k === r).length] as const)
      .filter(([, n]) => n > 0)
      .map(([r, n]) => `${n} ${r}`)
      .join(', ');
    out.push(`- Of the ${distinct.length} different memories ever injected, ${bad} (${pct(bad, distinct.length)}) are not facts${reasons ? `: ${reasons}` : ''}.`);
  }
  const founding = log.memoryEvents.flatMap((e) => e.memories).slice(0, 8);
  if (founding.length > 0 && log.turns.length >= 9) {
    const lateTurns = log.turns.slice(Math.floor((log.turns.length * 2) / 3));
    const stillIn = founding.filter((memory) => lateTurns.some((t) => t.debug.retrieval?.selected.some((s) => s.memory.content === memory))).length;
    out.push(`- The first ${founding.length} memories stored: ${stillIn} still reached the prompt in the last third of the run.`);
  }

  // ---- Card
  const prompt = firstPrompt(log);
  const example = cardSection(prompt, 'EXAMPLE DIALOGUE');
  out.push('');
  out.push('### Character card');
  out.push('');
  if (prompt === null) {
    out.push('Not available (the first turn\'s prompt was not logged).');
  } else if (example === null) {
    out.push('- No example dialogue in the card: a small model follows examples much more than rules, so two or three exchanges in the character\'s voice usually help.');
  } else if (example.length < 60 || /\b(test|todo|tbd|lorem|placeholder|example here)\b/i.test(example)) {
    out.push(`- The example dialogue looks like a placeholder (${example.length} characters: "${example.slice(0, 40)}"). Real exchanges in the character's voice would anchor the style.`);
  } else {
    out.push(`- Example dialogue present (${example.length} characters).`);
  }
  return out;
}

function totalLinesOf(speakers: Map<string, string[]>, except: string): string[] {
  const lines: string[] = [];
  for (const [speaker, texts] of speakers) if (speaker !== except) lines.push(...texts);
  return lines;
}
