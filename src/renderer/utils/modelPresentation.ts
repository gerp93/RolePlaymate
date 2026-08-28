import { detectModelFamily } from '../../shared/utils/modelFamily';
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

/** The name to show for a model: the fine-tune's own identity when the tag matches one of the
 * curated families (e.g. magnum:32b -> "Magnum"), not Ollama's `details.family`, which is
 * architecture-level -- Magnum, plain Mistral-Instruct, and TinyLlama all report family "llama"
 * despite being wholly different models, so that field alone would show "Llama" for all three.
 * Falls back to Ollama's own family (or the raw tag) for anything not in the curated list,
 * where there's no better identity to go on than what Ollama reports. */
export function displayModelName(info: OllamaModelInfo): string {
  const curated = detectModelFamily(info.name);
  if (curated) return familyDisplayName(curated);
  return info.family ? familyDisplayName(info.family) : info.name;
}

/** One-line label for a model picker: friendly name + size, condensed onto a single line since
 * a plain <option> can't render anything richer. Falls back to the raw tag alone for anything
 * unrecognized. */
export function conciseModelLabel(info: OllamaModelInfo): string {
  const name = displayModelName(info);
  const size = info.parameterSize ? ` ${info.parameterSize}` : '';
  return `${name}${size}`;
}

export function formatModelBytes(bytes: number): string {
  if (!bytes) return '';
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
}

/** Compact form for a context window, e.g. 131072 -> "131K". */
export function formatModelContext(tokens: number | null): string {
  if (!tokens) return '';
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export const MODEL_CAPABILITY_ICONS: Record<string, string> = {
  tools: '🛠',
  vision: '👁',
  thinking: '🧠',
};

export const MODEL_CAPABILITY_LABELS: Record<string, string> = {
  tools: 'Tool/function calling',
  vision: 'Image input',
  thinking: 'Thinking',
};

/** Secondary line for rich model pickers -- mirrors the Model Tuning table's metadata columns. */
export function modelPickerSubtext(info: OllamaModelInfo): string {
  const parts = [
    info.parameterSize,
    info.quantization,
    info.contextLength ? `${formatModelContext(info.contextLength)} ctx` : '',
    formatModelBytes(info.sizeBytes),
  ].filter(Boolean);
  return parts.join(' · ');
}

export function modelPickerExtraCapabilities(info: OllamaModelInfo): string[] {
  return info.capabilities.filter((c) => c !== 'completion');
}

export type ModelTier = 'Best' | 'Better' | 'Good';

export const MODEL_TIER_COLORS: Record<ModelTier, string> = {
  Best: 'var(--color-accent-green)',
  Better: 'var(--color-accent-blue)',
  Good: 'var(--color-text-muted)',
};

/** "12.2B" / "638M" -> billions of parameters as a plain number. 0 for anything unparsed. */
function paramsInBillions(parameterSize: string): number {
  const match = parameterSize.match(/^([\d.]+)\s*([BM])$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  return match[2].toUpperCase() === 'B' ? value : value / 1000;
}

function quantBits(quantization: string): number {
  const q = quantization.toUpperCase();
  if (q.includes('F16') || q.includes('FP16')) return 16;
  if (q.includes('Q8')) return 8;
  if (q.includes('Q6')) return 6;
  if (q.includes('Q5')) return 5;
  if (q.includes('Q4')) return 4;
  if (q.includes('Q3')) return 3;
  if (q.includes('Q2')) return 2;
  return 4;
}

/** Rank score for installed models -- see Model Tuning page for the rationale. */
export function modelCompositeScore(info: OllamaModelInfo): number {
  const params = paramsInBillions(info.parameterSize);
  if (params <= 0) return -Infinity;
  const quant = info.quantization ? quantBits(info.quantization) : 4;
  const context = info.contextLength && info.contextLength > 0 ? info.contextLength : 2048;
  return Math.log2(params) * 2 + quant * 0.5 + Math.log2(context) * 0.5;
}

/** Splits scoreable models into thirds by rank -- same rule as the Model Tuning table. */
export function assignModelTiers(models: OllamaModelInfo[]): Record<string, ModelTier> {
  const ranked = models
    .filter((m) => modelCompositeScore(m) > -Infinity)
    .sort((a, b) => modelCompositeScore(b) - modelCompositeScore(a) || a.name.localeCompare(b.name));
  const n = ranked.length;
  const tiers: Record<string, ModelTier> = {};
  ranked.forEach((m, i) => {
    tiers[m.name] = i < n / 3 ? 'Best' : i < (2 * n) / 3 ? 'Better' : 'Good';
  });
  return tiers;
}
