import { OllamaClient } from './ollamaClient';
import { dot, l2Normalize } from './memoryRetrieval';

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

/** The caller passes just the character-identity slice of the prompt (name/description/
 * personality/scenario/example dialogue -- see PromptBuilder.baseSystemPrompt), not the full
 * assembled system prompt with instructions/lore/memories/style directions layered on top. That
 * scoping is what keeps this cheap; this cap is only a safety valve against a pathologically
 * long character sheet, not the primary control -- it used to be 600 chars against the *whole*
 * prompt, which routinely cut personality traits before the extractor ever saw them, so it kept
 * "recording" them as new memories every turn. */
const SYSTEM_PROMPT_PREVIEW_LENGTH = 4000;

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
  // Mood and play-by-play narration rather than facts. A 12B roleplay model asked for "notable
  // events" will happily write "The atmosphere is charged with tension" every turn, and those
  // then rank as the most relevant memories to the very scene that produced them.
  'the atmosphere is',
  'the atmosphere has',
  'the conversation is',
  'the conversation has',
  'the tension',
  'is palpable',
  'the mood',
  'the scene is',
];

/**
 * Why a candidate is not a fact worth keeping, or null if it is.
 *
 * A 12B roleplay model asked for "notable events" writes three kinds of thing that are not facts, and each
 * does harm once stored:
 *
 *  - **Second person.** "The way you touch her shows your love": a memory is read back in a prompt where
 *    "you" is whoever is reading, and it is no longer clear who did what. Facts name the people.
 *  - **Commentary.** "...sets the stage for an intimate encounter", "...highlights the emotional
 *    connection": the model reviewing the scene as a critic. Retrieval then matches it to the very scene
 *    that produced it and feeds the commentary back as if it were an instruction, so the scene keeps
 *    escalating along the lines the commentary describes.
 *  - **Feelings.** "She is nervous about the dark tunnels": true for a moment, then repeated into the
 *    prompt for dozens of turns, and the character keeps announcing a feeling she no longer has.
 */
export function whyUnfit(candidate: string): 'second person' | 'commentary' | 'momentary' | 'feeling' | null {
  const text = candidate.trim();
  if (/\b(?:you|your|yours|yourself|you're|you've|you'll|you'd)\b/i.test(text)) return 'second person';
  if (
    /\b(?:showcas\w*|highlight\w*|underscor\w*|illustrat\w*|demonstrat\w*|symboli[sz]\w*|conveys?|conveying|evokes?|emphasi[sz]\w*|testament|speaks? to|serves? as|reinforc\w+ the|sets? the stage|turning point|subplot|palpable|intensif\w*|underlying|encapsulat\w*|epitomi[sz]\w*|adds? (?:another |a |an )?(?:layers?|depth|dimension|element)|creates? (?:a |an |the )?(?:sense|moment|atmosphere|anticipation|tension|tender|intimate|mood)|sense of (?:urgency|danger|dread|tension|unease|mystery|foreboding))\b/i.test(
      text
    ) ||
    /\b(?:suggests?|indicates?|implies|signals?|reflects?|reveals?|shows?)\s+(?:a|an|the|that the|that their|that her|that his)\s+(?:growing|deepening|budding|deep|strong|emotional|romantic|intimate|sensual|underlying|mutual|connection|bond|relationship|tension|intimacy|desire|attraction)/i.test(
      text
    )
  ) {
    return 'commentary';
  }
  // The model reading a mood or a body off the scene: "fear and urgency are evident in her demeanor".
  if (/\b(?:evident|apparent)\b|\bdemeanou?r\b|\bbody language\b/i.test(text)) return 'commentary';
  // What someone is in the middle of doing: "Cormac is taking a closer look at the evidence". True for a
  // line or two and then false for the rest of the story, yet it was injected on 40 of 100 turns in one run.
  // Only when the person is the sentence's subject, right at its start: "She believes someone at the Bureau
  // is watching her" is a fact, and its own subject comes later.
  if (
    /^\W*(?:[\w'’.-]+\s+){1,3}(?:is|are|was|were)\s+(?:now\s+|still\s+|currently\s+|just\s+)?(?:taking|having|giving|looking|examining|studying|inspecting|searching|waiting|standing|sitting|walking|moving|hiding|holding|pointing|gesturing|glancing|watching|listening|speaking|talking|asking|whispering|preparing|reaching|stepping|approaching|leaning|pressing|clutching|gripping|scanning|checking|reading|typing|sending|about to|trying to|beginning to|ready to)\b/i.test(
      text
    )
  ) {
    return 'momentary';
  }
  // Scene upkeep: what is going on right now, not what happened.
  if (/\b(?:is|are) (?:becoming|getting|growing|starting to)\b|\bcontinues? to\b|\b(?:keeps?|keep) (?:blaring|building|growing|rising)\b/i.test(text)) {
    return 'momentary';
  }
  if (
    /\b(?:is|are|was|were|feels?|felt|seems?|appears?|remains?)\s+(?:\w+ly\s+)?(?:nervous|anxious|scared|afraid|worried|uneasy|tense|excited|terrified|frightened|overwhelmed|relieved|conflicted|curious|eager|compelled|restless|apprehensive|uncomfortable|exhausted|shaken)\b/i.test(
      text
    ) ||
    /\b(?:in a state of|a (?:wave|surge|pang|rush|flicker|mix) of)\b/i.test(text)
  ) {
    return 'feeling';
  }
  return null;
}

/**
 * Cuts a trailing explanatory clause off a fact ("She hears gunshots behind her, indicating that he is fighting
 * the intruders"): the model's reading of the event, tacked on after the event itself. What is left is the
 * fact. Returns the text unchanged when there is no such clause, or when nothing sensible would remain.
 */
export function stripAnalyticTail(text: string): string {
  const cut = text
    .replace(
      /,?\s+(?:indicating|showing|highlighting|suggesting|reflecting|demonstrating|signaling|signalling|underscoring|emphasi[sz]ing|adding|creating|marking|making it clear|which (?:shows|suggests|indicates|highlights|underscores))\b.*$/i,
      ''
    )
    .trim();
  if (cut === text.trim() || cut.length <= MIN_FACT_LENGTH) return text;
  return /[.!?]$/.test(cut) ? cut : `${cut.replace(/[,;:]$/, '')}.`;
}

/** A new memory whose meaning is this close (cosine, via the embedding model) to one already
 * stored -- or to another candidate from the same exchange -- is dropped. Word overlap alone
 * (REDUNDANCY_THRESHOLD) misses paraphrases, which is how one scene became dozens of memories. */
export const SEMANTIC_DUPLICATE_THRESHOLD = 0.85;

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
    'RECORD only lasting facts that will still matter many scenes from now: decisions made,',
    'information revealed, questions raised that are still unanswered, who is suspected of what,',
    'goals, threats, changes in relationship, promises, injuries, plans agreed on. Be specific:',
    'keep the actual names, places, objects, codes and identifiers that were mentioned.',
    '',
    'Write each fact as a plain statement of what happened or was established, in the third person,',
    'naming the people involved (never "you", "your" or "the user"), the way a reference note would.',
    '',
    'DO NOT record:',
    '- momentary state or the scene itself: where someone is standing or sitting, what they are',
    '  doing, waiting for or looking at right now, sounds, weather, scenery. Those are true for one',
    '  moment and become wrong the moment the scene moves on.',
    '- feelings or mood ("is nervous", "feels a rush of desire"). They pass.',
    '- your own interpretation or commentary: what something "shows", "highlights", "suggests about',
    '  the relationship" or "sets the stage for". Record only what actually happened or was said.',
    '- descriptions of who a character already is, restatements of the setting, small talk, or',
    '  anything already listed below.',
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

  const facts = response
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((fact) => fact.length > MIN_FACT_LENGTH && fact.length < MAX_FACT_LENGTH);

  // The reply is capped at EXTRACTION_OPTIONS.num_predict tokens, so when it was cut off the last
  // bullet stops mid-sentence ("... with both characters clearly"). Storing that is worse than
  // dropping it: it is injected into prompts verbatim.
  if (facts.length > 0 && !/[.!?"')\]]\s*$/.test(response.trim())) facts.pop();
  return facts;
}

/**
 * Which candidates are not already covered, by meaning, by a stored memory or an earlier candidate.
 * `candidateVectors[i]` is the embedding of the i-th candidate; `existingVectors` are the cached
 * embeddings of stored memories (any without one are simply not compared against). Returns the
 * indices to keep, in order.
 */
export function pickSemanticallyNew(
  candidateVectors: number[][],
  existingVectors: number[][],
  threshold: number = SEMANTIC_DUPLICATE_THRESHOLD
): number[] {
  const known = existingVectors.map(l2Normalize);
  const keep: number[] = [];
  candidateVectors.forEach((raw, index) => {
    const vector = l2Normalize(raw);
    if (known.some((other) => dot(vector, other) >= threshold)) return;
    known.push(vector);
    keep.push(index);
  });
  return keep;
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

  for (const original of candidates) {
    // The event without the model's reading of it tacked on.
    const candidate = stripAnalyticTail(original);
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
    if (whyUnfit(candidate)) continue;

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
