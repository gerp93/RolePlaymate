/**
 * Recognizes a model *line* from its Ollama tag, for anything that wants to key off "this is a
 * Magnum" rather than Ollama's own `details.family` (which is architecture-level, not
 * lineage-level -- Magnum, plain Mistral-Instruct, and TinyLlama all report family "llama"
 * despite being wholly different models in practice). Shared between the Model Tuning page's
 * curated notes and its recommended sampler presets so the two can never drift apart -- same
 * detector, same key, in both main and renderer.
 */
export type ModelFamilyKey = 'magnum' | 'command-r' | 'qwen3' | 'gemma' | 'mistral' | 'tinyllama';

const FAMILY_MATCHERS: [ModelFamilyKey, RegExp][] = [
  ['magnum', /magnum/i],
  ['command-r', /command-r/i],
  ['qwen3', /qwen3/i],
  ['gemma', /gemma/i],
  ['tinyllama', /tinyllama/i],
  ['mistral', /mistral/i],
];

/** Checked in order, first match wins (so e.g. a future "magnum" tag doesn't fall through to
 * a broader match it happens to also contain). Null for anything unrecognized. */
export function detectModelFamily(modelTag: string): ModelFamilyKey | null {
  for (const [key, pattern] of FAMILY_MATCHERS) {
    if (pattern.test(modelTag)) return key;
  }
  return null;
}
