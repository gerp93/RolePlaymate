/**
 * Character limits for user-editable text. Shared by the renderer (maxLength + counters)
 * and the main process (IPC guards). SQLite stores TEXT with no column cap — these are
 * the app's policy limits.
 *
 * Tiers:
 * - name: titles and identifiers
 * - short: one-line taglines and descriptions
 * - loreKeys: comma-separated trigger lists
 * - proseContent: versioned character/persona/scenario/prompt prose
 * - greeting: scenario opening greetings
 * - loreText: lore entry body text
 * - chatMessage / directions / memory: live chat and continuity
 * - stopPhrases: multiline stop-phrase list
 * - url: Ollama / Chatterbox host string
 * - conversationTitle: renamed chat threads
 */
export const FIELD_LIMITS = {
  name: 100,
  short: 500,
  loreKeys: 1_000,
  proseContent: 5_000,
  greeting: 2_000,
  loreText: 2_000,
  chatMessage: 8_000,
  directions: 2_000,
  memory: 2_000,
  stopPhrases: 4_000,
  url: 2_048, // Ollama / Chatterbox host strings
  conversationTitle: 200,
} as const;

export type FieldLimitKey = keyof typeof FIELD_LIMITS;

export function assertMaxLength(
  value: string | null | undefined,
  limit: number,
  label: string
): void {
  if (value != null && value.length > limit) {
    throw new Error(`${label} must be at most ${limit.toLocaleString()} characters`);
  }
}

export function isNearLimit(length: number, limit: number): boolean {
  return length >= limit * 0.9;
}

export function isAtLimit(length: number, limit: number): boolean {
  return length >= limit;
}
