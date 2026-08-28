/**
 * Metadata Ollama's own `/api/tags` already reports per pulled model -- parameter count,
 * quantization, context window, disk size, capabilities. Distinct from the plain string list
 * `ollama:listModels` returns (used by the chat model dropdown, which only needs tags): this is
 * for anywhere that wants to *show* something about a model, not just pick one.
 *
 * Ollama has no separate "friendly display name" field -- `name` is the tag as pulled (which
 * for a community/namespaced model like `huihui_ai/qwen3-abliterated:14b` is not something
 * you'd want to show as a title). `family` is the closest thing to a clean identifier and is
 * what the Model Tuning page derives a display name from.
 */
export interface OllamaModelInfo {
  /** The tag as pulled, e.g. "huihui_ai/qwen3-abliterated:14b" -- the actual key used
   * everywhere else in the app (conversations, sampler tuning). */
  name: string;
  sizeBytes: number;
  /** e.g. "qwen3", "llama", "command-r" -- the base architecture, not the specific tag. */
  family: string;
  /** e.g. "14.8B" -- Ollama's own string, not reparsed into a number since its formatting
   * already varies ("7B" vs "12.2B") in ways not worth normalizing. */
  parameterSize: string;
  /** e.g. "Q4_K_M". */
  quantization: string;
  /** Null when Ollama doesn't report it for this model. */
  contextLength: number | null;
  /** e.g. ["completion", "tools", "thinking", "vision"]. */
  capabilities: string[];
}
