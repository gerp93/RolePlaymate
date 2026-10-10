import { OllamaClient } from './ollamaClient';
import { OverusedPhrases, STALL_NUDGE, describeOverused, findOverusedPhrases, isStalled } from './phraseGuard';

/**
 * Drafts what the user's persona might say or do next, for the "Suggest reply" button.
 *
 * Deliberately a single flat prompt with no system role and no chat-formatted history,
 * mirroring memoryExtraction's approach -- the normal chat system prompt explicitly forbids
 * writing the user's side ("NEVER write dialog, actions, or thoughts for the user"), which
 * would fight this request rather than serve it. Framing this as a standalone analysis task
 * instead of a chat turn sidesteps that entirely rather than trying to override it turn by turn.
 */

export const SUGGESTION_OPTIONS = {
  // Higher than a normal reply: the whole point of "suggest" is to offer a few different
  // directions to cycle through, not converge on one safe answer every time.
  temperature: 0.95,
  top_p: 0.95,
  num_predict: 150,
  // The persona's lines used to be drafted with nothing against repetition, so the same few phrases
  // ("my voice low and urgent") came back turn after turn. Same mild settings as a reply (see
  // DEFAULT_SAMPLERS): a long look-back, a light frequency penalty, min_p to trim odd choices.
  repeat_penalty: 1.1,
  repeat_last_n: 256,
  frequency_penalty: 0.15,
  min_p: 0.05,
};

/** One transcript line. `speakerName` labels an assistant line in a group conversation, where
 * several characters speak; without it the line is attributed to the one `characterName`. */
export interface SuggestionTurn {
  role: string;
  content: string;
  speakerName?: string | null;
}

export interface SuggestionExtras {
  /** What the persona should be doing or steering toward in this line (automated runs). */
  directions?: string;
  /** A previous draft repeated an earlier line; say so and ask for something different. */
  avoidRepeats?: boolean;
  /** Wording this persona has been leaning on in their own recent lines (found by suggestPersonaReply). */
  avoid?: OverusedPhrases;
  /** The scene has been going in circles (found by suggestPersonaReply): ask for a change. */
  stalled?: boolean;
}

function buildSuggestionPrompt(
  characterContext: string,
  historyTurns: SuggestionTurn[],
  characterName: string,
  personaName: string,
  extras: SuggestionExtras = {}
): string {
  const transcript = historyTurns
    .map(
      (turn) =>
        `${turn.role === 'assistant' ? (turn.speakerName ?? characterName) : personaName}: ${turn.content}`
    )
    .join('\n\n');

  const direction = extras.directions?.trim();

  return [
    characterContext.trim(),
    '',
    '[RECENT CONVERSATION]',
    transcript || '(no messages yet)',
    '[/RECENT CONVERSATION]',
    '',
    `You are helping ${personaName} -- the user's own character -- decide what to say or do`,
    `next, responding to ${characterName}'s most recent message above. Write ONE short,`,
    `in-character message as ${personaName}: their next line of dialogue and/or actions, in`,
    'the same voice as their earlier lines above.',
    ...(direction ? ['', `What ${personaName} is aiming for in this message: ${direction}`] : []),
    ...(describeOverused(extras.avoid) ? ['', describeOverused(extras.avoid).replace(/^Variety: /, 'Variety - ')] : []),
    ...(extras.stalled ? ['', STALL_NUDGE] : []),
    ...(extras.avoidRepeats
      ? [
          '',
          `Your last attempt repeated something already said above. Write something clearly different: do not copy or rephrase earlier lines (${characterName}'s included), and move the scene forward with a new action, question or piece of information.`,
        ]
      : []),
    '',
    `Do NOT write anything for ${characterName}. Do NOT include a name prefix or wrap the`,
    'whole reply in quotation marks. Reply with only the message itself.',
  ].join('\n');
}

/**
 * Cuts a draft that ran into the token cap back to its last complete sentence.
 *
 * The cap stops generation mid-sentence, and in an automated run that fragment is sent as the
 * persona's line (in the composer the user can fix it first). Plain text processing, no model:
 * keep everything up to the last sentence-ending mark (plus any closing quote or asterisk right
 * after it), then close a dangling `*` so formatting does not run on. A draft that already ends
 * cleanly, or has no sentence end at all, is returned as it came.
 */
export function trimToCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || /[.!?…][*"'”’)\]]*$/.test(trimmed) || /[*"”]$/.test(trimmed)) return trimmed;

  let cut = -1;
  const ends = /[.!?…][*"'”’)\]]*(?=\s|$)/g;
  for (let match = ends.exec(trimmed); match; match = ends.exec(trimmed)) {
    cut = match.index + match[0].length;
  }
  // Nothing sensible to cut back to -- a fragment is better than an empty message.
  if (cut <= 0) return trimmed;

  let result = trimmed.slice(0, cut).trim();
  if ((result.match(/\*/g) ?? []).length % 2 === 1) result += '*';
  // The cut can also land inside a spoken line.
  if ((result.match(/"/g) ?? []).length % 2 === 1) result += '"';
  return result;
}

/** Non-streaming: this is a short, one-shot draft, not a reply the user watches arrive. */
export async function suggestPersonaReply(
  ollama: OllamaClient,
  model: string,
  input: {
    characterContext: string;
    historyTurns: SuggestionTurn[];
    characterName: string;
    personaName: string;
    extras?: SuggestionExtras;
  },
  signal?: AbortSignal
): Promise<string> {
  // From the transcript itself, so every caller gets this: what this persona keeps saying (a phrase the
  // other side uses too is the scene's vocabulary, not a habit), and whether the scene has stopped moving.
  const personaLines = input.historyTurns.filter((t) => t.role !== 'assistant').map((t) => t.content);
  const characterLines = input.historyTurns.filter((t) => t.role === 'assistant').map((t) => t.content);
  const extras: SuggestionExtras = {
    ...input.extras,
    avoid: findOverusedPhrases(personaLines, {}, characterLines),
    stalled: isStalled(input.historyTurns.map((t) => t.content)),
  };
  const prompt = buildSuggestionPrompt(
    input.characterContext,
    input.historyTurns,
    input.characterName,
    input.personaName,
    extras
  );

  const others = otherSpeakerNames(input.characterName, input.personaName, input.historyTurns);
  const result = await ollama.chat({
    model,
    messages: [{ role: 'user', content: prompt }],
    options: {
      ...SUGGESTION_OPTIONS,
      // The draft is a line in a "Name: text" transcript, so the model will happily go on to write the
      // next speaker's turn. Stop it at the first label.
      stop: others.map((name) => `\n${name}:`),
      // The draft is built from a transcript the model is tempted to copy from; a heavier penalty
      // when it has just done so keeps the retry from landing on the same words.
      ...(input.extras?.avoidRepeats ? { temperature: 1.05, repeat_penalty: 1.25 } : {}),
    },
    signal,
  });

  return trimToCompleteSentence(cutOffOtherSpeakers(result.content, others));
}

/** Everyone in the transcript who is not the persona: the character and, in a group, the other speakers. */
export function otherSpeakerNames(characterName: string, personaName: string, turns: SuggestionTurn[]): string[] {
  const names = new Set<string>([characterName]);
  for (const turn of turns) if (turn.role === 'assistant' && turn.speakerName) names.add(turn.speakerName);
  names.delete(personaName);
  return [...names].filter((name) => name.trim().length > 0);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes any part of a draft that is another speaker's turn: from the first line that starts with their
 * label ("Veridia: ..."), and a label left dangling at the end of a line ("... consequences." Veridia: *).
 * The stop phrase usually prevents this, but a draft can still end on the start of the next turn, and the
 * trimmer treats a trailing `*` as a clean ending, so it was sent as part of the persona's line.
 */
export function cutOffOtherSpeakers(text: string, names: string[]): string {
  let result = text;
  for (const name of names) {
    const label = escapeRegExp(name);
    // A line that begins with their label (only if something comes before it: a draft that starts with
    // the label is left alone rather than emptied).
    const lineStart = new RegExp(`\\n[ \\t]*[*_]*${label}[*_]*[ \\t]*:`, 'i').exec(result);
    if (lineStart) result = result.slice(0, lineStart.index);
    // A label hanging at the very end of the text.
    result = result.replace(new RegExp(`[ \\t]+[*_]*${label}[*_]*[ \\t]*:[ \\t]*[*_"“]*\\s*$`, 'i'), '');
  }
  return result.trimEnd();
}
