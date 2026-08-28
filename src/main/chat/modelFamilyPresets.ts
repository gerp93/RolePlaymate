import { SamplerParams } from '../../shared/types/chat';
import { ModelFamilyKey } from '../../shared/utils/modelFamily';

/**
 * Recommended sampler starting points per model line -- the numeric counterpart to the Model
 * Tuning page's Notes column, and built from the same reasoning (general knowledge of how each
 * line tends to behave in roleplay, not something verified against any specific install or
 * fine-tune). Only the fields worth nudging away from DEFAULT_SAMPLERS are listed; anything
 * omitted here still falls back to DEFAULT_SAMPLERS for that field.
 *
 * This is the layer between DEFAULT_SAMPLERS and a user's own per-model override in
 * ModelSamplerService -- a saved override always wins per-field; an unset field falls back to
 * here before falling back to the flat global default.
 */
export const FAMILY_SAMPLER_PRESETS: Partial<Record<ModelFamilyKey, Partial<SamplerParams>>> = {
  // Built for expressive prose -- a touch more temperature for variety, lower repetition
  // penalty since it can fight natural phrase repetition in dialogue, a longer budget since it
  // tends to run long and cutting it off mid-thought reads worse than a slower reply.
  magnum: { temperature: 0.85, maxTokens: 320, topP: 0.9, repetitionPenalty: 1.05 },

  // RLHF'd toward an eager, formal assistant tone -- lower temperature and a firmer repetition
  // penalty to rein in the enthusiastic, exclamation-heavy register noticed in testing.
  'command-r': { temperature: 0.6, topP: 0.9, topK: 40, repetitionPenalty: 1.15 },

  // Leans assistant-flavored out of the box; a modest temperature bump loosens that up without
  // undermining the reasoning strength that's the actual point of this line.
  qwen3: { temperature: 0.75 },

  // Tends cautious/flat; a bit more temperature and Google's own commonly-recommended top-k
  // for this line.
  gemma: { temperature: 0.8, topK: 64 },

  // Generic instruct model, not roleplay-tuned -- default numbers are already a reasonable fit,
  // just a slight temperature nudge against terse replies.
  mistral: { temperature: 0.75 },

  // A ~1B test/placeholder model -- lower temperature and a shorter budget keep its already
  // weak coherence from wandering further than it has to.
  tinyllama: { temperature: 0.6, maxTokens: 128, topK: 40 },
};
