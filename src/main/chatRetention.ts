import { ConversationService } from './database/conversationService';
import { LorebookService } from './database/lorebookService';
import {
  ChatRetentionProgress,
  ChatRetentionRule,
  ChatRetentionRunResult,
  IDLE_RETENTION_PROGRESS,
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
  broadcastProgress: (progress: ChatRetentionProgress) => void;
}

let runtime: ChatRetentionRuntime | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let progress: ChatRetentionProgress = IDLE_RETENTION_PROGRESS;
let lastProgressBroadcast = 0;

/** What a cleanup in flight has done so far, for a Settings page opened mid-run. */
export function getRetentionProgress(): ChatRetentionProgress {
  return progress;
}

function setProgress(next: ChatRetentionProgress, force = false): void {
  progress = next;
  const now = Date.now();
  // ~10 updates a second is plenty for a bar; start and end always go out.
  if (!force && now - lastProgressBroadcast < 100) return;
  lastProgressBroadcast = now;
  runtime?.broadcastProgress(next);
}
/** Conversation currently on the Chat page. Skipped by in-session cleanup so the user isn't
 * yanked out of a thread they're looking at. Null on launch (nothing is open yet). */
let activeConversationId: string | null = null;

export function setRetentionActiveConversation(id: string | null): void {
  activeConversationId = id && typeof id === 'string' ? id : null;
}

export function startChatRetention(next: ChatRetentionRuntime): void {
  runtime = next;
  void runAutoRetention();
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
export async function runChatRetention(
  trigger: 'auto' | 'now' = 'auto',
  ruleId?: string
): Promise<ChatRetentionRunResult> {
  const empty: ChatRetentionRunResult = { deletedIds: [], deletedCount: 0 };
  if (!runtime) return empty;
  // One pass at a time: a second would list the same candidates and race the first's deletes.
  if (running) return empty;

  const saved = getChatRetentionState().rules;
  const rules = ruleId
    ? saved.filter((rule) => rule.id === ruleId)
    : retentionRulesForTrigger(saved, trigger);
  if (rules.length === 0) {
    return empty;
  }

  running = true;
  try {
    return await applyRetentionRules(rules, ruleId ?? null);
  } finally {
    running = false;
    setProgress(IDLE_RETENTION_PROGRESS, true);
  }
}

async function runAutoRetention(): Promise<void> {
  try {
    await runChatRetention('auto');
  } catch (error) {
    console.error('Chat retention failed:', error);
  }
}

/** Deleting is synchronous SQLite work on the main process, which also pumps every window's input. It is
 * done in small steps and control goes back to the event loop whenever a slice runs long, so a big cleanup
 * never freezes the UI and can report progress as it goes. */
const YIELD_AFTER_MS = 25;
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

async function applyRetentionRules(
  rules: ChatRetentionRule[],
  ruleId: string | null
): Promise<ChatRetentionRunResult> {
  const empty: ChatRetentionRunResult = { deletedIds: [], deletedCount: 0 };
  if (!runtime) return empty;

  const nowMs = Date.now();
  const matched = listEnrichedCandidates().filter(
    (candidate) =>
      candidate.id !== activeConversationId && conversationMatchesAnyRule(candidate, rules, nowMs)
  );
  const unitsOf = (candidate: RetentionCandidate) => candidate.messageCount + 1;

  let chatsDone = 0;
  let unitsDone = 0;
  const chatsTotal = matched.length;
  const unitsTotal = matched.reduce((sum, candidate) => sum + unitsOf(candidate), 0);
  const report = (force = false) =>
    setProgress({ running: true, ruleId, chatsDone, chatsTotal, unitsDone, unitsTotal }, force);
  report(true);

  const deletedIds: string[] = [];
  let sliceStart = Date.now();
  const maybeYield = async () => {
    if (Date.now() - sliceStart <= YIELD_AFTER_MS) return;
    report();
    await yieldToEventLoop();
    sliceStart = Date.now();
  };

  try {
    for (const candidate of matched) {
      // Awaiting lets the app carry on, so re-check that the runtime and the conversation are still valid.
      if (!runtime) break;
      if (candidate.id === activeConversationId || runtime.isGenerating(candidate.id)) {
        chatsDone += 1;
        unitsDone += unitsOf(candidate);
        continue;
      }
      runtime.dropSession(candidate.id);
      let removedMessages = 0;
      for (const removed of runtime.conversations.deleteConversationSteps(candidate.id)) {
        removedMessages += removed;
        unitsDone += removed;
        await maybeYield();
      }
      // The chat row itself, and any messages that arrived after the candidate list was read.
      unitsDone += Math.max(0, unitsOf(candidate) - removedMessages);
      chatsDone += 1;
      deletedIds.push(candidate.id);
      await maybeYield();
    }
  } finally {
    // Report what was deleted even if one delete threw, so the renderer drops those chats.
    if (runtime) {
      recordChatRetentionRun(deletedIds.length);
      if (deletedIds.length > 0) runtime.broadcastDeleted(deletedIds);
    }
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
    void runAutoRetention();
    scheduleNextMidnightRun();
  }, msUntilNextLocalMidnight());
}
