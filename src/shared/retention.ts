/** Chat retention: 0–N “delete if it matches” rules. An empty list means chats are kept
 * forever. A conversation is deleted when it matches any rule. Characters, personas, lore,
 * and scenarios are never in scope — only conversations and their spoken WAV files. */

export const RETENTION_AGE_DAYS = [1, 3, 7, 14, 30, 90, 180, 365] as const;
export type RetentionAgeDays = (typeof RETENTION_AGE_DAYS)[number];

export const RETENTION_AGE_LABELS: Record<RetentionAgeDays, string> = {
  1: '1 day',
  3: '3 days',
  7: '7 days',
  14: '14 days',
  30: '30 days',
  90: '90 days',
  180: '180 days',
  365: '1 year',
};

/** Presets are the dropdown; stored rules may use any integer in this range. */
export const RETENTION_AGE_DAYS_MIN = 1;
export const RETENTION_AGE_DAYS_MAX = 3650;

export type RetentionAgeFrom = 'firstMessage' | 'lastMessage';

export type RetentionMessageCountFilter =
  | { kind: 'any' }
  | { kind: 'fewerThan'; count: number }
  | { kind: 'atLeast'; count: number };

export type RetentionLibraryMatch = 'and' | 'or';

export interface ChatRetentionRule {
  id: string;
  /** Calendar days to keep a matching chat. Dropdown offers {@link RETENTION_AGE_DAYS}. */
  ageDays: number;
  ageFrom: RetentionAgeFrom;
  messageCount: RetentionMessageCountFilter;
  /** When true, this rule runs on app/DB open and at local midnight. */
  autoRun: boolean;
  /**
   * How library items combine when more than one type is set.
   * `or`: the chat involves any selected character, persona, or world book.
   * `and`: the chat involves at least one of each type that has items.
   */
  libraryMatch: RetentionLibraryMatch;
  /** Empty means any character. Each entry can further limit that character to specific scenarios. */
  characterFilters: RetentionCharacterFilter[];
  /** Empty means any persona. Otherwise the chat's persona must be one of these. */
  personaIds: string[];
  /** Empty means any world book. Otherwise the chat must involve at least one of these. */
  lorebookIds: string[];
}

export interface RetentionCharacterFilter {
  characterId: string;
  /** Empty means any scenario (including none) for this character. */
  scenarioIds: string[];
}

export interface ChatRetentionState {
  rules: ChatRetentionRule[];
  lastRunAt: string | null;
  lastDeletedCount: number;
}

export interface ChatRetentionRunResult {
  deletedIds: string[];
  deletedCount: number;
}

/** One conversation row as the matcher sees it — timestamps are ISO-8601. */
export interface RetentionCandidate {
  id: string;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  characterId: string | null;
  userPersonaId: string | null;
  scenarioId: string | null;
  /** World (and personal) books brought in by this chat's character and/or persona. */
  lorebookIds: string[];
}

export const MAX_RETENTION_RULES = 20;
export const RETENTION_MESSAGE_COUNT_MIN = 1;
export const RETENTION_MESSAGE_COUNT_MAX = 10_000;
export const DEFAULT_RETENTION_MESSAGE_COUNT = 8;

const MS_PER_DAY = 86_400_000;

export function isRetentionAgeDays(n: number): n is RetentionAgeDays {
  return (RETENTION_AGE_DAYS as readonly number[]).includes(n);
}

export function clampRetentionAgeDays(n: number): number {
  if (!Number.isFinite(n)) return 30;
  return Math.min(RETENTION_AGE_DAYS_MAX, Math.max(RETENTION_AGE_DAYS_MIN, Math.floor(n)));
}

export function formatRetentionAge(days: number): string {
  if (isRetentionAgeDays(days)) return RETENTION_AGE_LABELS[days];
  return days === 1 ? '1 day' : `${days} days`;
}

export function clampRetentionMessageCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_MESSAGE_COUNT;
  return Math.min(
    RETENTION_MESSAGE_COUNT_MAX,
    Math.max(RETENTION_MESSAGE_COUNT_MIN, Math.floor(n))
  );
}

export function createDraftRetentionRule(): RetentionRuleDraft {
  return {
    id: crypto.randomUUID(),
    ageDays: null,
    ageFrom: null,
    messageCount: null,
    autoRun: false,
    libraryMatch: 'or',
    characterFilters: [],
    personaIds: [],
    lorebookIds: [],
  };
}

/** A rule being edited in Settings before every required field is set. Not persisted. */
export interface RetentionRuleDraft {
  id: string;
  ageDays: number | null;
  ageFrom: RetentionAgeFrom | null;
  messageCount: RetentionMessageCountFilter | null;
  autoRun: boolean;
  libraryMatch: RetentionLibraryMatch;
  characterFilters: RetentionCharacterFilter[];
  personaIds: string[];
  lorebookIds: string[];
}

export function isRetentionRuleComplete(rule: RetentionRuleDraft): rule is ChatRetentionRule {
  if (rule.ageDays == null || rule.ageFrom == null || !rule.messageCount) return false;
  if (rule.ageDays < RETENTION_AGE_DAYS_MIN || rule.ageDays > RETENTION_AGE_DAYS_MAX) return false;
  if (rule.messageCount.kind === 'fewerThan' || rule.messageCount.kind === 'atLeast') {
    const n = rule.messageCount.count;
    if (!Number.isInteger(n) || n < RETENTION_MESSAGE_COUNT_MIN || n > RETENTION_MESSAGE_COUNT_MAX) {
      return false;
    }
  }
  return true;
}

export function parseRetentionRules(raw: unknown): ChatRetentionRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: ChatRetentionRule[] = [];
  for (const item of raw) {
    const rule = parseRetentionRule(item);
    if (rule) rules.push(rule);
    if (rules.length >= MAX_RETENTION_RULES) break;
  }
  return rules;
}

function parseRetentionRule(raw: unknown): ChatRetentionRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : crypto.randomUUID();
  const rawDays = typeof row.ageDays === 'number' ? row.ageDays : Number(row.ageDays);
  if (!Number.isFinite(rawDays) || rawDays < RETENTION_AGE_DAYS_MIN) return null;
  const ageDays = clampRetentionAgeDays(rawDays);
  const ageFrom: RetentionAgeFrom | null =
    row.ageFrom === 'firstMessage' || row.ageFrom === 'lastMessage' ? row.ageFrom : null;
  if (!ageFrom) return null;
  const messageCount = parseMessageCount(row.messageCount);
  if (!messageCount) return null;
  return {
    id,
    ageDays,
    ageFrom,
    messageCount,
    autoRun: row.autoRun === true,
    libraryMatch: row.libraryMatch === 'or' ? 'or' : 'and',
    characterFilters: parseCharacterFilters(row),
    personaIds: parseIdList(row.personaIds),
    lorebookIds: parseIdList(row.lorebookIds),
  };
}

function parseIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseCharacterFilters(row: Record<string, unknown>): RetentionCharacterFilter[] {
  if (Array.isArray(row.characterFilters)) {
    const filters: RetentionCharacterFilter[] = [];
    const seen = new Set<string>();
    for (const item of row.characterFilters) {
      if (!item || typeof item !== 'object') continue;
      const filter = item as Record<string, unknown>;
      const characterId = typeof filter.characterId === 'string' ? filter.characterId.trim() : '';
      if (!characterId || seen.has(characterId)) continue;
      seen.add(characterId);
      filters.push({ characterId, scenarioIds: parseIdList(filter.scenarioIds) });
    }
    return filters;
  }
  return parseIdList(row.characterIds).map((characterId) => ({ characterId, scenarioIds: [] }));
}

function parseMessageCount(raw: unknown): RetentionMessageCountFilter | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.kind === 'any') return { kind: 'any' };
  if (row.kind === 'fewerThan') {
    return { kind: 'fewerThan', count: clampRetentionMessageCount(Number(row.count)) };
  }
  if (row.kind === 'atLeast') {
    return { kind: 'atLeast', count: clampRetentionMessageCount(Number(row.count)) };
  }
  return null;
}

export function conversationMatchesRule(
  candidate: RetentionCandidate,
  rule: ChatRetentionRule,
  nowMs: number
): boolean {
  const anchor =
    rule.ageFrom === 'firstMessage'
      ? candidate.firstMessageAt ?? candidate.createdAt
      : candidate.lastMessageAt ?? candidate.firstMessageAt ?? candidate.createdAt;
  const then = Date.parse(anchor);
  if (!Number.isFinite(then)) return false;
  if (nowMs - then < rule.ageDays * MS_PER_DAY) return false;
  if (!conversationMatchesLibrary(candidate, rule)) return false;

  switch (rule.messageCount.kind) {
    case 'any':
      return true;
    case 'fewerThan':
      return candidate.messageCount < rule.messageCount.count;
    case 'atLeast':
      return candidate.messageCount >= rule.messageCount.count;
  }
}

function conversationMatchesLibrary(
  candidate: RetentionCandidate,
  rule: ChatRetentionRule
): boolean {
  const characterOn = rule.characterFilters.length > 0;
  const personaOn = rule.personaIds.length > 0;
  const loreOn = rule.lorebookIds.length > 0;
  if (!characterOn && !personaOn && !loreOn) return true;

  const characterHit = characterOn && conversationMatchesCharacter(candidate, rule.characterFilters);
  const personaId = candidate.userPersonaId;
  const personaHit = personaOn && personaId != null && rule.personaIds.includes(personaId);
  const loreHit = loreOn && rule.lorebookIds.some((id) => candidate.lorebookIds.includes(id));

  if (rule.libraryMatch === 'or') return characterHit || personaHit || loreHit;
  return (!characterOn || characterHit) && (!personaOn || personaHit) && (!loreOn || loreHit);
}

function conversationMatchesCharacter(
  candidate: RetentionCandidate,
  filters: RetentionCharacterFilter[]
): boolean {
  if (!candidate.characterId) return false;
  const filter = filters.find((item) => item.characterId === candidate.characterId);
  if (!filter) return false;
  if (filter.scenarioIds.length > 0) {
    return Boolean(candidate.scenarioId && filter.scenarioIds.includes(candidate.scenarioId));
  }
  return true;
}

export function conversationMatchesAnyRule(
  candidate: RetentionCandidate,
  rules: ChatRetentionRule[],
  nowMs: number
): boolean {
  return rules.some((rule) => conversationMatchesRule(candidate, rule, nowMs));
}

/** `now` uses every rule. `auto` uses only rules with automatic cleanup enabled. */
export function retentionRulesForTrigger(
  rules: ChatRetentionRule[],
  trigger: 'auto' | 'now'
): ChatRetentionRule[] {
  if (trigger === 'now') return rules;
  return rules.filter((rule) => rule.autoRun);
}

export function summarizeRetentionRule(rule: ChatRetentionRule): string {
  const age = formatRetentionAge(rule.ageDays);
  const from = rule.ageFrom === 'firstMessage' ? 'date of first message' : 'date of last message';
  const count = summarizeMessageCount(rule.messageCount);
  return `Older than ${age} (from ${from})${count ? `, ${count}` : ''}`;
}

/** True when a rule's filters name any of the given hidden entity ids. */
export function retentionRuleInvolvesHidden(
  rule: ChatRetentionRule,
  hiddenCharacterIds: Set<string>,
  hiddenPersonaIds: Set<string>,
  hiddenLorebookIds: Set<string>,
  hiddenScenarioIds: Set<string>
): boolean {
  return (
    rule.characterFilters.some(
      (filter) =>
        hiddenCharacterIds.has(filter.characterId) ||
        filter.scenarioIds.some((id) => hiddenScenarioIds.has(id))
    ) ||
    rule.personaIds.some((id) => hiddenPersonaIds.has(id)) ||
    rule.lorebookIds.some((id) => hiddenLorebookIds.has(id))
  );
}

function summarizeMessageCount(filter: RetentionMessageCountFilter): string {
  switch (filter.kind) {
    case 'any':
      return '';
    case 'fewerThan':
      return `fewer than ${filter.count} messages`;
    case 'atLeast':
      return `at least ${filter.count} messages`;
  }
}
