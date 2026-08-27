import { OllamaClient } from './ollamaClient';

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
};

function buildSuggestionPrompt(
  characterContext: string,
  historyTurns: { role: string; content: string }[],
  characterName: string,
  personaName: string
): string {
  const transcript = historyTurns
    .map((turn) => `${turn.role === 'assistant' ? characterName : personaName}: ${turn.content}`)
    .join('\n\n');

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
    '',
    `Do NOT write anything for ${characterName}. Do NOT include a name prefix or wrap the`,
    'whole reply in quotation marks. Reply with only the message itself.',
  ].join('\n');
}

/** Non-streaming: this is a short, one-shot draft, not a reply the user watches arrive. */
export async function suggestPersonaReply(
  ollama: OllamaClient,
  model: string,
  input: {
    characterContext: string;
    historyTurns: { role: string; content: string }[];
    characterName: string;
    personaName: string;
  },
  signal?: AbortSignal
): Promise<string> {
  const prompt = buildSuggestionPrompt(
    input.characterContext,
    input.historyTurns,
    input.characterName,
    input.personaName
  );

  const result = await ollama.chat({
    model,
    messages: [{ role: 'user', content: prompt }],
    options: SUGGESTION_OPTIONS,
    signal,
  });

  return result.content.trim();
}
