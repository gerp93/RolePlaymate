import { isDirectionsOnly, type Message } from '../../shared/types/message';
import type { OllamaChatMessage } from './ollamaClient';

/** Label for the user's lines when no persona is selected -- matches promptBuilder's fallback so
 * `{{user}}` and the transcript prefix agree. */
const DEFAULT_USER_LABEL = 'User';

export interface GroupHistoryOptions {
  personaName: string | null;
  /** Sliding window over the transcript's non-system messages, same meaning as the solo path's
   * history limit. Applied before merging, so it counts messages, not merged turns. */
  limit: number;
  /** A one-character conversation's own character, for when a guest has spoken (see
   * isGuestLine). Replies written before that, and its greeting, never recorded a speaker --
   * without this they would read as some other character's lines. Unused for a real group,
   * where every line records its speaker. */
  defaultSpeaker?: { id: string; name: string };
}

/**
 * Whether an assistant line was written by someone other than a solo conversation's own
 * character -- a guest brought in with "Respond as". A line whose speaker row was deleted
 * (`speakerCharacterId` null, `speakerName` kept) is still a guest's: a line from before guests
 * existed has neither.
 */
export function isGuestLine(message: Message, leadCharacterId: string): boolean {
  if (message.role !== 'assistant') return false;
  if (message.speakerCharacterId) return message.speakerCharacterId !== leadCharacterId;
  return message.speakerName !== null;
}

function userLine(personaName: string | null, text: string): string {
  return `${personaName?.trim() || DEFAULT_USER_LABEL}: ${text}`;
}

/** Adds an entry, merging into the previous one when it has the same role -- most chat templates
 * expect roles to alternate. In a group two other characters routinely speak back to back, and a
 * character who continues on their own speaks twice in a row. Returns a new array; the input is
 * not mutated. */
function pushTurn(turns: OllamaChatMessage[], role: 'user' | 'assistant', content: string): OllamaChatMessage[] {
  const last = turns.at(-1);
  if (last?.role === role) {
    return [...turns.slice(0, -1), { role, content: `${last.content}\n\n${content}` }];
  }
  return [...turns, { role, content }];
}

/**
 * Folds neighbouring turns of the same role into one, so what a model is sent strictly alternates.
 * A conversation gains back-to-back assistant turns every time a character continues on their own
 * (and back-to-back user turns when a message went unanswered); models handle a run of them badly
 * -- the more there are, the likelier the reply drifts into writing the other side. The stored
 * transcript is untouched; this only shapes the request.
 */
export function mergeAdjacentTurns(turns: OllamaChatMessage[]): OllamaChatMessage[] {
  const out: OllamaChatMessage[] = [];
  for (const turn of turns) {
    const prev = out.at(-1);
    if (prev && prev.role === turn.role && turn.role !== 'system') {
      out[out.length - 1] = { ...prev, content: `${prev.content}\n\n${turn.content}` };
    } else {
      out.push({ ...turn });
    }
  }
  return out;
}

/**
 * Rebuilds a group conversation's history from one speaker's point of view.
 *
 * Ollama only knows `user` and `assistant`, so a three-way scene has to be folded into two roles:
 * the speaker's own past lines are `assistant`; everything else -- the user and every other
 * character -- is `user`, each line prefixed `Name: ` so the model can tell voices apart.
 *
 * Pure and driven by the stored transcript rather than `ChatSession.history`, because that cache
 * is one flat, speaker-less list -- the same transcript reads differently to each character.
 */
export function buildGroupHistory(
  transcript: readonly Message[],
  speakerCharacterId: string,
  options: GroupHistoryOptions
): OllamaChatMessage[] {
  const window = transcript.filter((m) => m.role !== 'system').slice(-Math.max(options.limit, 0));

  let turns: OllamaChatMessage[] = [];
  const fallback = options.defaultSpeaker;
  for (const message of window) {
    if (message.role === 'user') {
      // A directions-only line has no words to show anyone -- see isDirectionsOnly.
      if (isDirectionsOnly(message)) continue;
      turns = pushTurn(turns, 'user', userLine(options.personaName, message.content));
      continue;
    }
    // The fallback applies only to a line with no speaker information at all -- one whose speaker
    // was deleted still has its name, and belongs to that (now removed) character.
    const unattributed = !message.speakerCharacterId && !message.speakerName;
    const lineSpeakerId = message.speakerCharacterId ?? (unattributed ? (fallback?.id ?? null) : null);
    const lineSpeakerName = message.speakerName ?? (unattributed ? (fallback?.name ?? null) : null);
    if (lineSpeakerId === speakerCharacterId) {
      turns = pushTurn(turns, 'assistant', message.content);
    } else {
      // Another character -- or a line whose speaker was never recorded, which just goes in bare.
      turns = pushTurn(turns, 'user', lineSpeakerName ? `${lineSpeakerName}: ${message.content}` : message.content);
    }
  }
  return turns;
}

/** Appends the user's message being sent this turn (not yet in the transcript) to a history built
 * by `buildGroupHistory`, labelled and merged the same way the stored lines were. */
export function appendUserLine(
  turns: OllamaChatMessage[],
  personaName: string | null,
  text: string
): OllamaChatMessage[] {
  return pushTurn(turns, 'user', userLine(personaName, text));
}

/**
 * Drops a leading "Name: " the model copied from the transcript's labelling convention. This is
 * the one place reply post-processing goes beyond trim(), and it is deliberately narrow: only the
 * speaker's own name, only at the very start, only in group conversations -- a label the app's
 * own history format taught the model, not text the model meant. Never returns an empty string
 * for a non-empty reply.
 */
export function stripSelfLabel(content: string, speakerName: string): string {
  const escaped = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // "Name: text", or the same label wrapped in markdown emphasis ("**Name:** text", "*Name*: text").
  // The wrapped form requires the colon, so an action that merely starts with the name
  // ("*Bram shrugs*") is left alone.
  const wrapped = new RegExp(`^\\s*(\\*{1,2})\\s*${escaped}\\s*(?::\\s*\\1|\\1\\s*:)\\s*`);
  const plain = new RegExp(`^\\s*${escaped}\\s*:\\s*`);
  const stripped = content.replace(wrapped, '').replace(plain, '');
  return stripped.trim() ? stripped : content;
}
