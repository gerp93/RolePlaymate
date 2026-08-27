/**
 * `world` books are shared setting material, attachable to any number of characters.
 * `personal` books hold one character's private history and belong to that character alone.
 * The scope decides how the entries are framed in the prompt, not just where they live.
 */
export type LorebookScope = 'world' | 'personal';

export interface Lorebook {
  id: string;
  name: string;
  description: string | null;
  scope: LorebookScope;
  /** Set for a character's personal book only; null otherwise. */
  ownerCharacterId: string | null;
  /** Set for a persona's personal book only; null otherwise. */
  ownerPersonaId: string | null;
  /** World books only: an optional cover image, shown on the World books grid. */
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLorebookInput {
  name: string;
  description?: string;
  scope?: LorebookScope;
  /** Required when scope is 'personal' and the owner is a character. */
  ownerCharacterId?: string;
  /** Required when scope is 'personal' and the owner is a persona. */
  ownerPersonaId?: string;
}

export interface UpdateLorebookInput {
  name?: string;
  description?: string;
  image?: string | null;
}

/** One piece of lore. Its text is versioned; this row holds the trigger configuration. */
export interface LorebookEntry {
  id: string;
  lorebookId: string;
  title: string;
  /** Trigger keywords as authored, comma-separated. Empty means key-less. */
  keys: string;
  enabled: boolean;
  /** Injected every turn regardless of keys. */
  alwaysOn: boolean;
  /** Higher wins when matched entries don't all fit the token budget. */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLorebookEntryInput {
  lorebookId: string;
  title: string;
  keys?: string;
  content?: string;
  alwaysOn?: boolean;
  priority?: number;
}

export interface UpdateLorebookEntryInput {
  title?: string;
  keys?: string;
  enabled?: boolean;
  alwaysOn?: boolean;
  priority?: number;
}

/** Same shape as CharacterFieldVersion -- lore entries use the app's versioning model. */
export interface LorebookEntryVersion {
  id: string;
  entryId: string;
  versionNumber: number;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Why an entry made it into this turn's prompt. Surfaced in the debug console so a
 * misfiring entry can be diagnosed without guesswork. */
export type LoreMatchReason = 'always-on' | 'keyword';

export interface MatchedLoreEntry {
  entryId: string;
  title: string;
  scope: LorebookScope;
  lorebookName: string;
  content: string;
  reason: LoreMatchReason;
  /** The key that actually fired, for 'keyword' matches. */
  matchedKey: string | null;
  priority: number;
  estimatedTokens: number;
}

/** The outcome of one lore scan, kept whole so the debug console can show what was
 * considered and rejected, not just what was injected. */
export interface LoreScanResult {
  selected: MatchedLoreEntry[];
  /** Matched but dropped -- budget exhausted, or over the per-turn entry cap. */
  rejected: MatchedLoreEntry[];
  /** Enabled entries that were in scope but whose keys never fired. */
  consideredCount: number;
  budgetTokensUsed: number;
  budgetTokensMax: number;
  /** The text the keys were scanned against, for "why didn't this fire?". */
  scanText: string;
}
