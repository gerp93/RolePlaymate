import { ConversationService } from './database/conversationService';
import { LorebookService } from './database/lorebookService';
import {
  ChatRetentionRule,
  ChatRetentionRunResult,
  RetentionCandidate,
  conversationMatchesAnyRule,
  conversationMatchesRule,
  parseRetentionRules,
  retentionRulesForTrigger,
} from '../shared/retention';
import {
  getChatRetentionState,
  recordChatRetentionRun,
  setChatRetentionRules,
} from './dbLocation';

export interface ChatRetentionRuntime {
  conversations: ConversationService;
  lorebooks: LorebookService;
  isGenerating: (conversationId: string) => boolean;
  dropSession: (conversationId: string) => void;
  broadcastDeleted: (deletedIds: string[]) => void;
}

let runtime: ChatRetentionRuntime | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
/** Conversation currently on the Chat page. Skipped by in-session cleanup so the user isn't
 * yanked out of a thread they're looking at. Null on launch (nothing is open yet). */
let activeConversationId: string | null = null;

export function setRetentionActiveConversation(id: string | null): void {
  activeConversationId = id && typeof id === 'string' ? id : null;
}

export function startChatRetention(next: ChatRetentionRuntime): void {
  runtime = next;
  runChatRetention('auto');
  scheduleNextMidnightRun();
}

export function stopChatRetention(): void {
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
}

/** Persist rules without running cleanup. Automatic runs stay on the schedule; use runNow to delete now. */
export function saveChatRetentionRules(rules: unknown): { rules: ChatRetentionRule[] } {
  return { rules: setChatRetentionRules(rules) };
}

/** `auto` uses only rules with automatic cleanup enabled. `now` uses every rule.
 * Pass `ruleId` to run a single saved rule (manual, ignores that rule's autoRun flag). */
export function runChatRetention(trigger: 'auto' | 'now' = 'auto', ruleId?: string): ChatRetentionRunResult {
  const empty: ChatRetentionRunResult = { deletedIds: [], deletedCount: 0 };
  if (!runtime) return empty;

  const saved = getChatRetentionState().rules;
  const rules = ruleId
    ? saved.filter((rule) => rule.id === ruleId)
    : retentionRulesForTrigger(saved, trigger);
  if (rules.length === 0) {
    return empty;
  }

  return applyRetentionRules(rules);
}

function applyRetentionRules(rules: ChatRetentionRule[]): ChatRetentionRunResult {
  const empty: ChatRetentionRunResult = { deletedIds: [], deletedCount: 0 };
  if (!runtime) return empty;

  const nowMs = Date.now();
  const skip = new Set<string>();
  if (activeConversationId) skip.add(activeConversationId);

  const deletedIds: string[] = [];
  const candidates = listEnrichedCandidates();
  for (const candidate of candidates) {
    if (skip.has(candidate.id)) continue;
    if (runtime.isGenerating(candidate.id)) continue;
    if (!conversationMatchesAnyRule(candidate, rules, nowMs)) continue;
    runtime.dropSession(candidate.id);
    runtime.conversations.deleteConversation(candidate.id);
    deletedIds.push(candidate.id);
  }

  recordChatRetentionRun(deletedIds.length);
  if (deletedIds.length > 0) {
    runtime.broadcastDeleted(deletedIds);
  }
  return { deletedIds, deletedCount: deletedIds.length };
}

/** Per-rule counts of committed chats that match right now. Kept conversations and
 * greeting-only drafts are already excluded by listRetentionCandidates. */
export function previewRetentionMatches(rules: unknown): Record<string, number> {
  const parsed = parseRetentionRules(rules);
  const counts: Record<string, number> = {};
  for (const rule of parsed) counts[rule.id] = 0;
  if (!runtime || parsed.length === 0) return counts;
  const nowMs = Date.now();
  const candidates = listEnrichedCandidates();
  for (const rule of parsed) {
    let n = 0;
    for (const candidate of candidates) {
      if (conversationMatchesRule(candidate, rule, nowMs)) n += 1;
    }
    counts[rule.id] = n;
  }
  return counts;
}

function listEnrichedCandidates(): RetentionCandidate[] {
  if (!runtime) return [];
  const lore = runtime.lorebooks.listLorebookIdsByOwner();
  return runtime.conversations.listRetentionCandidates().map((candidate) => {
    const lorebookIds = new Set<string>();
    if (candidate.characterId) {
      for (const id of lore.byCharacterId[candidate.characterId] ?? []) lorebookIds.add(id);
    }
    if (candidate.userPersonaId) {
      for (const id of lore.byPersonaId[candidate.userPersonaId] ?? []) lorebookIds.add(id);
    }
    return { ...candidate, lorebookIds: [...lorebookIds] };
  });
}

function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  // At least a minute so a clock-skewed "already midnight" case can't tight-loop.
  return Math.max(60_000, next.getTime() - now.getTime());
}

function scheduleNextMidnightRun(): void {
  if (midnightTimer) clearTimeout(midnightTimer);
  midnightTimer = setTimeout(() => {
    runChatRetention('auto');
    scheduleNextMidnightRun();
  }, msUntilNextLocalMidnight());
}
