import { ChatterboxCloneVoice } from '../types/tts';

/** Short mixed-tone line so a preview isn't a single flat syllable. */
export const TTS_VOICE_PREVIEW_TEXT =
  'Hello there. This is a short sample so you can hear how this voice sounds.';

function filenameOnly(value: string): string {
  return value.replace(/^.*[/\\]/, '').trim();
}

/** Friendly label when the user hasn't stored a name: stem of the clip filename. */
export function cloneDisplayName(filename: string, names: Record<string, string> = {}): string {
  const stored = names[filename]?.trim();
  if (stored) return stored;
  const stem = filename.replace(/\.(wav|mp3)$/i, '').trim();
  return stem || filename;
}

/** Accepts `{ filename, displayName }` or a raw filename string (stale main-process IPC). */
export function normalizeCloneVoices(
  clones: unknown,
  names: Record<string, string> = {}
): ChatterboxCloneVoice[] {
  if (!Array.isArray(clones)) return [];
  const seen = new Set<string>();
  const result: ChatterboxCloneVoice[] = [];
  for (const item of clones) {
    let filename = '';
    let displayName = '';
    if (typeof item === 'string') {
      filename = filenameOnly(item);
    } else if (item && typeof item === 'object') {
      const row = item as { filename?: unknown; displayName?: unknown; name?: unknown };
      filename = typeof row.filename === 'string' ? filenameOnly(row.filename) : '';
      displayName =
        typeof row.displayName === 'string' && row.displayName.trim()
          ? row.displayName.trim()
          : typeof row.name === 'string' && row.name.trim()
            ? row.name.trim()
            : '';
    }
    if (!filename) continue;
    const key = filename.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      filename,
      displayName: displayName || cloneDisplayName(filename, names),
    });
  }
  return result;
}

/** Filename stem Chatterbox will accept -- letters, numbers, dot, hyphen; spaces become underscores. */
export function stemFromVoiceName(name: string): string {
  return name
    .trim()
    .replace(/\.(wav|mp3)$/i, '')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
