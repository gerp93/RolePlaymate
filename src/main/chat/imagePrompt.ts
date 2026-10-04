import { OllamaClient } from './ollamaClient';
import { SuggestionTurn } from './suggestReply';

/**
 * Turns the current scene into a text-to-image prompt, for the "Generate image" button.
 *
 * Same shape as suggestReply and memoryExtraction -- one flat analysis prompt rather than a
 * chat turn -- because the normal system prompt is all roleplay rules that would fight a
 * request to describe the scene instead of continuing it. The loaded chat model writes it, so
 * no second model has to be pulled.
 */

export const IMAGE_PROMPT_OPTIONS = {
  temperature: 0.7,
  top_p: 0.9,
  num_predict: 260,
};

/** Image models only see the prompt, never the chat, so every visual fact has to be spelled
 * out. How many recent lines is enough to know the current moment without drowning the model. */
export const IMAGE_PROMPT_HISTORY_LINES = 8;

function buildImagePromptRequest(input: {
  characterContext: string;
  historyTurns: SuggestionTurn[];
  characterName: string;
  personaName: string;
  hint?: string;
}): string {
  const transcript = input.historyTurns
    .map(
      (turn) =>
        `${turn.role === 'assistant' ? (turn.speakerName ?? input.characterName) : input.personaName}: ${turn.content}`
    )
    .join('\n\n');
  const hint = input.hint?.trim();

  return [
    input.characterContext.trim(),
    '',
    '[RECENT CONVERSATION]',
    transcript || '(no messages yet)',
    '[/RECENT CONVERSATION]',
    '',
    'Write a prompt for a text-to-image model that captures the current moment of the scene above',
    `as a single illustration. ${input.characterName} and ${input.personaName} are the likely subjects.`,
    '',
    'The image model has never seen this conversation and knows nothing about these characters, so',
    'describe everything visually and never rely on names alone: who is in frame, their apparent',
    'age, build, hair, clothing, expression and pose, then the setting, time of day, lighting and',
    'mood. Keep it concrete and visible -- no dialogue, no thoughts, no backstory, no text in the',
    'image. Use one paragraph of comma-separated phrases, at most 90 words.',
    hint ? `\nThe user wants the image to focus on: ${hint}` : '',
    '',
    'Reply with only the prompt itself. No label, no quotation marks, no explanation.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Models still sometimes label or quote the prompt despite being told not to; strip just those. */
export function cleanImagePrompt(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^(?:image\s+)?prompt\s*:\s*/i, '');
  if (/^["“].*["”]$/s.test(text)) text = text.slice(1, -1);
  return text.replace(/\s*\n+\s*/g, ' ').trim();
}

/** Non-streaming: one short draft the user reviews and edits before anything is generated. */
export async function composeImagePrompt(
  ollama: OllamaClient,
  model: string,
  input: {
    characterContext: string;
    historyTurns: SuggestionTurn[];
    characterName: string;
    personaName: string;
    hint?: string;
  },
  signal?: AbortSignal
): Promise<string> {
  const result = await ollama.chat({
    model,
    messages: [{ role: 'user', content: buildImagePromptRequest(input) }],
    options: IMAGE_PROMPT_OPTIONS,
    signal,
  });
  return cleanImagePrompt(result.content);
}
