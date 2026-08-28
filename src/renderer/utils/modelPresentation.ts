import { ModelFamilyKey, detectModelFamily } from '../../shared/utils/modelFamily';
import { OllamaModelInfo } from '../../shared/types/ollama';

/** Ollama has no separate "friendly name" field -- `family` (e.g. "qwen3", "command-r") is the
 * closest thing to a clean identifier, so this just splits on the punctuation Ollama's own
 * family strings use and capitalizes each piece ("command-r" -> "Command R"). Not an official
 * display name, just a readable stand-in for the raw tag. */
export function familyDisplayName(family: string): string {
  if (!family) return '';
  return family
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Curated notes on how each model line tends to behave in a roleplay/chat context --
 * strengths and weaknesses, not something Ollama's API reports. Keyed by the same
 * ModelFamilyKey the recommended sampler presets use (shared/utils/modelFamily.ts and
 * main/chat/modelFamilyPresets.ts), so the two can never drift apart -- one detector, one key,
 * feeding both the text here and the numbers there. General community consensus as of this
 * app's knowledge cutoff, not a guarantee for every specific fine-tune sharing a name; treat as
 * a starting point, not a spec sheet. Shared by the Model Tuning page and the chat model
 * dropdown, so the same characterization shows up wherever a model gets described.
 */
export const MODEL_NOTES: Record<ModelFamilyKey, { summary: string; detail: string }> = {
  magnum: {
    summary: 'Roleplay-tuned, strong prose',
    detail:
      'Fine-tuned specifically for creative writing and in-character dialogue (trained to imitate high-quality prose style). Generally uncensored. Strengths: natural, varied dialogue; good at staying in character. Weaknesses: can run verbose or purple-prose-y; less reliable for precise instruction-following or factual tasks.',
  },
  'command-r': {
    summary: 'Huge context, formal/eager tone',
    detail:
      "Built for RAG/tool-use, with a very large context window (128K+) that's genuinely useful for long-running chats. Strengths: huge context, decent multilingual and tool-calling. Weaknesses: RLHF'd toward a helpful-assistant tone that can leak into roleplay as overly formal, enthusiastic, or eager to \"help\" rather than stay in character -- try lowering temperature/repetition penalty if it feels stiff.",
  },
  qwen3: {
    summary: 'Strong reasoning, assistant-flavored',
    detail:
      'General-purpose model with an optional hidden "thinking" pass. Strengths: strong instruction-following and reasoning; "abliterated" variants (like an installed one here) have refusal behavior removed, useful for mature content. Weaknesses: base tone leans toward a helpful-assistant register rather than roleplay flair; abliteration is a post-hoc patch and can occasionally cost a little coherence.',
  },
  gemma: {
    summary: 'Efficient, more cautious tone',
    detail:
      "Google's general instruction-tuned line; newer versions add vision and tool support. Strengths: efficient for their size, decent instruction-following, can process images where vision is supported. Weaknesses: stronger built-in content moderation than most -- can add disclaimers or soften scenes; not specifically roleplay-tuned.",
  },
  tinyllama: {
    summary: 'Test/placeholder model',
    detail:
      "Extremely small (~1B) general-purpose model. Strengths: very fast, minimal resource use -- useful for testing the app's plumbing, not for real conversations. Weaknesses: weak coherence and instruction-following; not really usable for actual roleplay.",
  },
  mistral: {
    summary: 'Fast, generic instruct',
    detail:
      'General small instruction model, not roleplay-tuned. Strengths: fast, low resource use. Weaknesses: terse or generic dialogue, weaker long-context coherence, some built-in caution.',
  },
};

export function modelNotes(model: string): { summary: string; detail: string } | null {
  const family = detectModelFamily(model);
  return family ? MODEL_NOTES[family] : null;
}

/** One-line label for a model picker: friendly name + size, then the same curated notes
 * summary as the Model Tuning page, condensed onto a single line since a plain <option> can't
 * render anything richer. Falls back to the raw tag alone for anything unrecognized. */
export function conciseModelLabel(info: OllamaModelInfo): string {
  const name = info.family ? familyDisplayName(info.family) : info.name;
  const size = info.parameterSize ? ` ${info.parameterSize}` : '';
  const notes = modelNotes(info.name);
  const suffix = notes ? ` — ${notes.summary}` : '';
  return `${name}${size}${suffix}`;
}
