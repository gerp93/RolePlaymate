import { OllamaModelInfo } from './types/ollama';

/** Ollama embedding model used for semantic memory retrieval. */
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

export type EmbeddingModelStatus =
  | { ollamaReachable: true; model: string; installed: true }
  | { ollamaReachable: true; model: string; installed: false }
  | { ollamaReachable: false; model: string; installed: false; message: string };

/** True for models meant for `/api/embed` only — not chat completion, so they belong in
 *  Settings/memory setup rather than Model Tuning or Chat's model picker. */
export function isEmbeddingModel(model: OllamaModelInfo | string): boolean {
  if (typeof model !== 'string') {
    if (model.capabilities.includes('embed') && !model.capabilities.includes('completion')) {
      return true;
    }
    return isEmbeddingModelName(model.name);
  }
  return isEmbeddingModelName(model);
}

export function filterEmbeddingModels(models: OllamaModelInfo[]): OllamaModelInfo[] {
  return models.filter(isEmbeddingModel);
}

function isEmbeddingModelName(name: string): boolean {
  const base = name.split(':')[0].toLowerCase();
  if (base === DEFAULT_EMBEDDING_MODEL) return true;
  // Fallback when Ollama doesn't report capabilities (older builds, orphaned rows).
  return (
    base.includes('embed') ||
    base.startsWith('bge-') ||
    base.startsWith('mxbai-embed') ||
    base.startsWith('snowflake-arctic-embed')
  );
}