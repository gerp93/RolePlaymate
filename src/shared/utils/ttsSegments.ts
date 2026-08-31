import { CharacterTtsVoice } from '../types/tts';
import { textForSpeech } from './ttsText';

/** Who should speak a reply: one voice for the whole message, or italics vs the rest. */
export type TtsReadingMode = 'character' | 'narrator' | 'split';

/** Whether a speech track is silent, auto-plays after the line lands, or waits for Speak. */
export type TtsTrackMode = 'off' | 'auto' | 'click';

/** When the next line is ready: wait for the current clip to finish, or cut it off.
 * Either way only one clip plays at a time. */
export type TtsOverlapMode = 'queue' | 'interrupt';

export type TtsSpeechRole = 'character' | 'narrator';

export interface TtsSpeechClip {
  role: TtsSpeechRole;
  text: string;
  voice: CharacterTtsVoice;
}

export function voicesMatch(a: CharacterTtsVoice | null, b: CharacterTtsVoice | null): boolean {
  return Boolean(a && b && a.mode === b.mode && a.id === b.id);
}

/**
 * Splits roleplay markup into narrator (`*italic*`) vs character (everything else, including
 * quotes). `**bold**` is left as character text. Unmatched asterisks stay with the character.
 * Adjacent runs of the same role are merged.
 */
export function splitItalicNarration(content: string): Array<{ role: TtsSpeechRole; text: string }> {
  const source = content.replace(/\r\n/g, '\n');
  const out: Array<{ role: TtsSpeechRole; text: string }> = [];

  const push = (role: TtsSpeechRole, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.text += text;
      return;
    }
    out.push({ role, text });
  };

  let i = 0;
  let buffer = '';
  while (i < source.length) {
    const ch = source[i];
    if (ch === '*' && source[i + 1] !== '*') {
      let j = i + 1;
      let closer = -1;
      while (j < source.length) {
        if (source[j] === '*' && source[j + 1] === '*') {
          j += 2;
          continue;
        }
        if (source[j] === '*') {
          closer = j;
          break;
        }
        j += 1;
      }
      const inner = closer >= 0 ? source.slice(i + 1, closer) : '';
      if (closer >= 0 && inner.trim()) {
        push('character', buffer);
        buffer = '';
        push('narrator', inner);
        i = closer + 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  push('character', buffer);
  return out;
}

/**
 * Builds the Chatterbox queue. One speaker (or split that collapses to one speaker) stays a
 * single request so Chatterbox can stitch the whole reply. Split only queues when both voices
 * exist, they differ, and there is at least one italic run and one non-italic run.
 */
export function planSpeechClips(
  content: string,
  mode: TtsReadingMode,
  speakerVoice: CharacterTtsVoice | null,
  narratorVoice: CharacterTtsVoice | null
): TtsSpeechClip[] {
  if (!textForSpeech(content)) return [];

  const speaker = speakerVoice;
  const narrator = narratorVoice;
  const fallback = speaker ?? narrator;
  if (!fallback) return [];

  if (mode === 'narrator') {
    return [{ role: 'narrator', text: content, voice: narrator ?? fallback }];
  }

  const canSplit =
    mode === 'split' && Boolean(speaker) && Boolean(narrator) && !voicesMatch(speaker, narrator);

  if (!canSplit) {
    return [{ role: 'character', text: content, voice: fallback }];
  }

  const parts = splitItalicNarration(content)
    .map((part) => ({ role: part.role, text: part.text, spoken: textForSpeech(part.text) }))
    .filter((part) => part.spoken);

  if (parts.length <= 1) {
    const role = parts[0]?.role ?? 'character';
    return [
      {
        role,
        text: content,
        voice: role === 'narrator' ? narrator! : speaker!,
      },
    ];
  }

  return parts.map((part) => ({
    role: part.role,
    text: part.text,
    voice: part.role === 'narrator' ? narrator! : speaker!,
  }));
}
