/**
 * A chat's moods: what each speaker is feeling right now, until the user changes it. Stored on the
 * conversation as one JSON object keyed by the speaker's character id (a group, or a guest in a
 * one-character chat, has several speakers; a single shared mood would make everyone feel the same).
 * Pure helpers so the storage format lives in one place and is testable without a database.
 */
export type Moods = Record<string, string>;

/** Reads the stored column. Anything unreadable (null, bad JSON, wrong shape) is "no moods", never a throw:
 * a mood is a nicety and must not be able to break opening a chat. */
export function parseMoods(raw: string | null | undefined): Moods {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const moods: Moods = {};
    for (const [speakerId, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) moods[speakerId] = value.trim();
    }
    return moods;
  } catch {
    return {};
  }
}

/** The moods with one speaker's set, or cleared when `mood` is blank. Returns a new object. */
export function withMood(moods: Moods, speakerId: string, mood: string | null | undefined): Moods {
  const next = { ...moods };
  const trimmed = mood?.trim();
  if (trimmed) next[speakerId] = trimmed;
  else delete next[speakerId];
  return next;
}

/** What to store: null when nobody has a mood, so an unused column stays NULL. */
export function serializeMoods(moods: Moods): string | null {
  return Object.keys(moods).length > 0 ? JSON.stringify(moods) : null;
}
