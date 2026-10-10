import { textSimilarity } from './memoryExtraction';
import { trimToCompleteSentence } from './suggestReply';

/**
 * Noticing that a story has moved somewhere new, so the chat can offer to update its scene note.
 *
 * After a reply, a short side call reads the last few lines and says either that the setting is
 * unchanged or, in one sentence, where things are now. This file is just the prompt and the
 * reading of the answer; ChatSessionManager.checkScene makes the call. Pure, so it is tested
 * without a model.
 */

/** A check runs on every this-many'th assistant reply -- a place rarely changes every turn, and
 * each check is a second model call competing with the next reply for the GPU. */
export const SCENE_CHECK_EVERY = 2;

/** A suggestion this close (word overlap) to the current note, or to the last one offered, is a
 * rephrasing and is dropped rather than asked about again. */
export const SCENE_SIMILARITY_SKIP = 0.6;

/** Word overlap compares whitespace-separated tokens, so "dawn," and "dawn." would differ. */
function plainWords(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, ' ');
}

const MAX_SUGGESTION_CHARS = 300;
const MIN_SUGGESTION_CHARS = 12;
const LINE_CHARS = 600;

export interface SceneLine {
  speaker: string;
  content: string;
}

export function buildSceneCheckPrompt(note: string | null, recent: SceneLine[]): string {
  const transcript = recent
    .map((line) => `${line.speaker}: ${line.content.slice(0, LINE_CHARS)}`)
    .join('\n\n');
  const current = note?.trim();

  return [
    'You keep track of where a roleplay scene is taking place.',
    '',
    `Current scene note: ${current ? current : '(none yet)'}`,
    '',
    'Latest lines:',
    transcript,
    '',
    current
      ? 'Has the setting changed since the scene note -- a new place, a clearly different time, or a clearly different situation? If not, answer with exactly: SAME'
      : 'Describe the scene as it is now.',
    'Otherwise answer with ONE sentence (at most 30 words) saying where they are now and what is happening.',
    'Facts only: place, time and situation. No feelings, no opinions, no quotation marks, no label.',
  ].join('\n');
}

/**
 * The suggested scene note, or null when there is nothing worth offering: the model said SAME,
 * answered with nothing usable, or only restated the current note or what was already offered.
 */
export function parseSceneSuggestion(
  response: string,
  currentNote: string | null,
  lastSuggested: string | null
): string | null {
  const firstLine = response
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  if (/^same\b/i.test(firstLine)) return null;

  let text = firstLine
    .replace(/^[-*]\s+/, '')
    .replace(/^(?:scene(?: note)?|setting|now)\s*:\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
  if (text.length > MAX_SUGGESTION_CHARS) text = trimToCompleteSentence(text.slice(0, MAX_SUGGESTION_CHARS));
  if (text.length < MIN_SUGGESTION_CHARS) return null;

  for (const known of [currentNote, lastSuggested]) {
    if (known?.trim() && textSimilarity(plainWords(text), plainWords(known)) >= SCENE_SIMILARITY_SKIP) return null;
  }
  return text;
}
