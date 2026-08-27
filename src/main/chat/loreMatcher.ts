import { EntryWithContent } from '../database/lorebookService';
import { MatchedLoreEntry, LoreScanResult } from '../../shared/types/lorebook';

export interface LoreScanOptions {
  /** How many trailing messages the keys are scanned against, plus the pending user message.
   * Small on purpose: lore should fire on what the scene is about *now*, not on something
   * mentioned twenty turns ago. */
  scanDepth?: number;
  /** Rough token ceiling for injected lore, so a large book can't crowd out the transcript. */
  tokenBudget?: number;
  /** Hard cap on entries per turn, independent of budget. */
  maxEntries?: number;
}

export const DEFAULT_LORE_OPTIONS: Required<LoreScanOptions> = {
  scanDepth: 6,
  tokenBudget: 500,
  maxEntries: 12,
};

/** Same rough estimate the memory budget uses -- ~4 characters per token. Deliberately
 * approximate: it only has to rank and cap, not predict the tokenizer exactly. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

/** Splits an authored key list. Commas separate; blanks are dropped so a trailing comma or
 * a double comma doesn't create an empty key that would match everything. */
export function parseKeys(keys: string): string[] {
  return keys
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

/**
 * Whether `key` appears in `text` as a whole word.
 *
 * Word-boundary rather than substring: a key of "Ash" matching inside "ashamed" or "cash"
 * is the classic lorebook failure, and it's invisible until you notice an entry firing in
 * scenes it has nothing to do with. Multi-word keys are matched as phrases.
 *
 * The key is regex-escaped because keys are user text and will contain things like
 * "Vance (captain)" or "C++" -- an unescaped key would either throw or match wrongly.
 */
export function keyMatches(key: string, text: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b is unreliable at non-ASCII boundaries, so the edges are asserted explicitly against
  // "not a word character" instead, which behaves for accented and non-Latin keys too.
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'iu');
  return pattern.test(text);
}

/** The text keys are scanned against: the recent transcript plus the message being sent. */
export function buildScanText(
  recentMessages: { role: string; content: string }[],
  pendingUserMessage: string,
  scanDepth: number
): string {
  // `slice(-0)` is `slice(0)` and returns the WHOLE array, so a scanDepth of 0 would scan
  // everything -- the exact opposite of what it asks for. Guard it explicitly.
  const window = scanDepth > 0 ? recentMessages.slice(-scanDepth).map((m) => m.content) : [];
  return [...window, pendingUserMessage].join('\n');
}

/**
 * Decides which lore entries this turn gets.
 *
 * Selection order and budgeting mirror the memory retriever so the two behave alike:
 * always-on entries first (they're always-on for a reason and shouldn't lose a budget race
 * to a keyword hit), then keyword matches by priority. An entry that doesn't fit the
 * remaining budget is rejected but the walk continues, so a short entry after a long one
 * still gets in.
 *
 * Everything rejected is returned too -- the debug console shows it, which is the only
 * practical way to answer "why didn't my entry fire?".
 */
export function scanLore(
  entries: EntryWithContent[],
  recentMessages: { role: string; content: string }[],
  pendingUserMessage: string,
  options: LoreScanOptions = {}
): LoreScanResult {
  const { scanDepth, tokenBudget, maxEntries } = { ...DEFAULT_LORE_OPTIONS, ...options };
  const scanText = buildScanText(recentMessages, pendingUserMessage, scanDepth);

  const matched: MatchedLoreEntry[] = [];

  for (const { entry, book, content } of entries) {
    // An entry with no text would contribute an empty bullet -- worse than absent, because
    // it tells the model a fact exists and then doesn't supply it.
    if (!content.trim()) continue;

    const keys = parseKeys(entry.keys);
    let reason: MatchedLoreEntry['reason'] | null = null;
    let matchedKey: string | null = null;

    if (entry.alwaysOn) {
      reason = 'always-on';
    } else {
      const hit = keys.find((key) => keyMatches(key, scanText));
      if (hit) {
        reason = 'keyword';
        matchedKey = hit;
      }
    }

    if (!reason) continue;

    matched.push({
      entryId: entry.id,
      title: entry.title,
      scope: book.scope,
      lorebookName: book.name,
      content: content.trim(),
      reason,
      matchedKey,
      priority: entry.priority,
      estimatedTokens: estimateTokens(content),
    });
  }

  // Always-on first, then by priority, then alphabetically so the order is stable rather
  // than depending on the database's row order.
  matched.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === 'always-on' ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.title.localeCompare(b.title);
  });

  const selected: MatchedLoreEntry[] = [];
  const rejected: MatchedLoreEntry[] = [];
  let remaining = tokenBudget;

  for (const candidate of matched) {
    if (selected.length >= maxEntries) {
      rejected.push(candidate);
      continue;
    }
    if (candidate.estimatedTokens > remaining) {
      // Reject but keep going: a later, shorter entry may still fit.
      rejected.push(candidate);
      continue;
    }
    selected.push(candidate);
    remaining -= candidate.estimatedTokens;
  }

  return {
    selected,
    rejected,
    consideredCount: entries.length,
    budgetTokensUsed: tokenBudget - remaining,
    budgetTokensMax: tokenBudget,
    scanText,
  };
}

/** Selected entries split by scope, since the two are framed differently in the prompt. */
export function splitByScope(selected: MatchedLoreEntry[]): {
  world: MatchedLoreEntry[];
  personal: MatchedLoreEntry[];
} {
  return {
    world: selected.filter((entry) => entry.scope === 'world'),
    personal: selected.filter((entry) => entry.scope === 'personal'),
  };
}
