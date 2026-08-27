import { OllamaClient } from './ollamaClient';

/**
 * Pulls durable facts out of a completed exchange, so a long conversation keeps continuity
 * without resending the whole transcript.
 *
 * Ported from KVGenius's chat_gen.extract_memories and its filter chain, with two changes:
 * this runs *after* the reply has been delivered (the source ran it inline, adding its
 * latency to every turn), and candidates are deduped against each other as well as against
 * what is already stored (the source only checked existing memories, so one extraction
 * could insert two near-identical facts).
 */

export const EXTRACTION_OPTIONS = {
  temperature: 0.2,
  top_p: 0.85,
  num_predict: 150,
  stop: ['\nUser:', '\nAssistant:', '\n\n\n'],
};

/** The system prompt is truncated before being shown to the extractor: it is there to say
 * "don't re-record this", and the whole thing would dominate the request. */
const SYSTEM_PROMPT_PREVIEW_LENGTH = 600;

const MIN_FACT_LENGTH = 5;
const MAX_FACT_LENGTH = 300;

/** Jaccard similarity above this counts as "already recorded". */
export const REDUNDANCY_THRESHOLD = 0.65;

/** Above this share of meaningful words already in the system prompt, the "fact" is just
 * restating the character sheet. */
export const SYSTEM_PROMPT_OVERLAP_THRESHOLD = 0.6;

/** Phrases that mark a "memory" as a description of the character rather than an event. */
export const GENERIC_PHRASES = [
  'is a character',
  'is described as',
  'has a personality',
  'the setting is',
  'takes place in',
  'is known for',
  'character traits',
  'appearance includes',
];

/** Word-set overlap. Cheap, order-insensitive, and good enough to catch restatements. */
export function textSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

function buildExtractionPrompt(
  userMessage: string,
  aiResponse: string,
  existingMemories: string[],
  systemPrompt: string
): string {
  const existing =
    existingMemories.length > 0
      ? `\nAlready recorded memories (do NOT repeat these):\n${existingMemories
          .map((memory) => `- ${memory}`)
          .join('\n')}\n`
      : '';

  const systemNote = systemPrompt.trim()
    ? `The following character/setting info is ALREADY in the system prompt (do NOT record any of this):\n${systemPrompt.slice(
        0,
        SYSTEM_PROMPT_PREVIEW_LENGTH
      )}...\n`
    : '';

  return [
    'You are extracting durable facts from a roleplay exchange, to be remembered later.',
    '',
    'RECORD: things that happened, decisions made, information revealed, changes in',
    'relationship or state, promises, injuries, locations reached.',
    'DO NOT record: descriptions of who a character already is, restatements of the setting,',
    'small talk, or anything already listed below.',
    '',
    'Reply with one "- " bullet per fact, and nothing else. Reply with exactly NONE if there',
    'is nothing worth remembering.',
    '',
    systemNote,
    existing,
    `User: ${userMessage}`,
    `Assistant: ${aiResponse}`,
    '',
    'Notable events from this exchange:',
  ].join('\n');
}

/** Keeps only "- " bullets of a sensible length; bails on the NONE sentinel. */
export function parseExtractedFacts(response: string): string[] {
  if (response.toUpperCase().includes('NONE') && response.trim().length < 20) return [];

  return response
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((fact) => fact.length > MIN_FACT_LENGTH && fact.length < MAX_FACT_LENGTH);
}

/**
 * Drops candidates that restate something already known.
 *
 * Three filters, all from the source: near-duplicates of stored memories, "facts" that are
 * mostly words already in the system prompt (i.e. the character sheet read back), and
 * descriptive boilerplate.
 *
 * The intra-batch check is the addition -- without it a single extraction can insert two
 * phrasings of the same event.
 */
export function filterRedundant(
  candidates: string[],
  systemPrompt: string,
  existingMemories: string[]
): string[] {
  const systemLower = systemPrompt.toLowerCase();
  const kept: string[] = [];

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase().trim();

    if (existingMemories.some((existing) => textSimilarity(lower, existing.toLowerCase()) > REDUNDANCY_THRESHOLD)) {
      continue;
    }
    // Also against what we've already accepted from this same batch.
    if (kept.some((accepted) => textSimilarity(lower, accepted.toLowerCase()) > REDUNDANCY_THRESHOLD)) {
      continue;
    }

    const meaningful = lower.split(/\s+/).filter((word) => word.length > 3);
    if (meaningful.length > 2) {
      const overlap = meaningful.filter((word) => systemLower.includes(word)).length / meaningful.length;
      if (overlap > SYSTEM_PROMPT_OVERLAP_THRESHOLD) continue;
    }

    if (GENERIC_PHRASES.some((phrase) => lower.includes(phrase))) continue;

    kept.push(candidate);
  }

  return kept;
}

/**
 * Asks the model what is worth remembering from one exchange.
 *
 * Non-streaming: partial output is useless here, and this is exactly the short internal call
 * the non-streaming path exists for. Returns [] rather than throwing when the server is
 * unreachable -- a failed extraction should cost the conversation nothing.
 */
export async function extractMemories(
  ollama: OllamaClient,
  model: string,
  input: {
    userMessage: string;
    aiResponse: string;
    existingMemories: string[];
    systemPrompt: string;
  },
  signal?: AbortSignal
): Promise<string[]> {
  const prompt = buildExtractionPrompt(
    input.userMessage,
    input.aiResponse,
    input.existingMemories,
    input.systemPrompt
  );

  try {
    const result = await ollama.chat({
      model,
      // No system role and no history, matching the source: this is a one-shot analysis
      // task, and conversation context would bias it toward roleplaying instead.
      messages: [{ role: 'user', content: prompt }],
      options: EXTRACTION_OPTIONS,
      signal,
    });

    const facts = parseExtractedFacts(result.content);
    return filterRedundant(facts, input.systemPrompt, input.existingMemories);
  } catch {
    return [];
  }
}
