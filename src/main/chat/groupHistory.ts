import type { Message } from '../../shared/types/message';
import type { OllamaChatMessage } from './ollamaClient';

/** Label for the user's lines when no persona is selected -- matches promptBuilder's fallback so
 * `{{user}}` and the transcript prefix agree. */
const DEFAULT_USER_LABEL = 'User';

export interface GroupHistoryOptions {
  personaName: string | null;
  /** Sliding window over the transcript's non-system messages, same meaning as the solo path's
   * history limit. Applied before merging, so it counts messages, not merged turns. */
  limit: number;
}

function userLine(personaName: string | null, text: string): string {
  return `${personaName?.trim() || DEFAULT_USER_LABEL}: ${text}`;
}

/** Adds a `user`-role entry, merging into the previous one when that is also `user` -- most chat
 * templates expect roles to alternate, and in a group two other characters routinely speak back
 * to back. Returns a new array; the input is not mutated. */
function pushTurn(turns: OllamaChatMessage[], role: 'user' | 'assistant', content: string): OllamaChatMessage[] {
  const last = turns.at(-1);
  if (role === 'user' && last?.role === 'user') {
    return [...turns.slice(0, -1), { role: 'user', content: `${last.content}\n\n${content}` }];
  }
  return [...turns, { role, content }];
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
  for (const message of window) {
    if (message.role === 'user') {
      turns = pushTurn(turns, 'user', userLine(options.personaName, message.content));
    } else if (message.speakerCharacterId === speakerCharacterId) {
      turns = pushTurn(turns, 'assistant', message.content);
    } else {
      // Another character -- or a line whose speaker was never recorded, which just goes in bare.
      turns = pushTurn(
        turns,
        'user',
        message.speakerName ? `${message.speakerName}: ${message.content}` : message.content
      );
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
