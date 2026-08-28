/**
 * Thin HTTP client for a locally-running Ollama server, ported from KVGenius's
 * core/ollama_client.py.
 *
 * The app loads no model itself and makes no network calls of its own -- everything here
 * targets a server the user runs on their own machine. Uses global `fetch`, so no dependency.
 */
import { OllamaModelInfo } from '../../shared/types/ollama';

export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

/** Timeouts match the source: generous for chat, very generous for a multi-GB model pull. */
const CHAT_TIMEOUT_MS = 300_000;
const REQUEST_TIMEOUT_MS = 30_000;
const PULL_TIMEOUT_MS = 3_600_000;

/** Raised for anything that means "the server isn't usable": connection refused, DNS
 * failure, timeout, or a non-2xx response. Deliberately one error type -- from the UI's
 * point of view they all mean the same thing and want the same message. */
export class OllamaUnavailableError extends Error {
  constructor(host: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Ollama not reachable at ${host}: ${detail}`);
    this.name = 'OllamaUnavailableError';
  }
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Ollama's own option names (snake_case), not this app's. Passed through verbatim. */
export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
  num_predict?: number;
  stop?: string[];
}

export interface OllamaChatResult {
  content: string;
  /** Token counts arrive only in the final NDJSON chunk; null when the server omits them. */
  promptEvalCount: number | null;
  evalCount: number | null;
}

export interface ChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  options?: OllamaOptions;
  /** Called per token when streaming. Omit for a single-shot request. */
  onToken?: (text: string) => void;
  signal?: AbortSignal;
}

export class OllamaClient {
  constructor(private hostProvider: () => string = () => DEFAULT_OLLAMA_HOST) {}

  get host(): string {
    return (this.hostProvider() || DEFAULT_OLLAMA_HOST).replace(/\/+$/, '');
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const host = this.host;
    // Combine the caller's cancellation with our timeout so either can abort the request.
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(`${host}${path}`, { ...init, signal });
    } catch (error) {
      // A caller-initiated abort is not a server problem -- let it through untouched so the
      // caller can distinguish "user pressed stop" from "server is down".
      if (init.signal?.aborted) throw error;
      throw new OllamaUnavailableError(host, error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new OllamaUnavailableError(host, `HTTP ${response.status} ${body}`.trim());
    }
    return response;
  }

  /** Tags of every model the server currently has pulled. */
  async listModels(): Promise<string[]> {
    const response = await this.request('/api/tags', { method: 'GET' }, REQUEST_TIMEOUT_MS);
    const data = (await response.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => m.name ?? '').filter(Boolean);
  }

  /** Same `/api/tags` call as listModels, but keeping the metadata it already reports per
   * model (parameter count, quantization, context window, disk size, capabilities) instead of
   * discarding everything but the tag -- see the Model Tuning settings page. */
  async listModelsDetailed(): Promise<OllamaModelInfo[]> {
    const response = await this.request('/api/tags', { method: 'GET' }, REQUEST_TIMEOUT_MS);
    const data = (await response.json()) as { models?: OllamaTagsModel[] };
    return (data.models ?? [])
      .map((m) => ({
        name: m.name ?? m.model ?? '',
        sizeBytes: m.size ?? 0,
        family: m.details?.family ?? '',
        parameterSize: m.details?.parameter_size ?? '',
        quantization: m.details?.quantization_level ?? '',
        contextLength: m.details?.context_length ?? null,
        capabilities: m.capabilities ?? [],
      }))
      .filter((m) => m.name);
  }

  /**
   * Whether a tag is pulled.
   *
   * Unlike the source, this normalises the implicit `:latest` suffix. Ollama reports
   * `llama3:latest` in /api/tags, so the source's exact-string match said "not downloaded"
   * for a perfectly present `llama3`.
   */
  async isModelAvailable(tag: string): Promise<boolean> {
    const available = await this.listModels();
    return available.some((name) => equivalentTags(name, tag));
  }

  /**
   * One chat completion.
   *
   * Streams when `onToken` is given (the source never did -- it always sent
   * `"stream": false`). The non-streaming path is kept for the short internal calls,
   * memory extraction and prompt suggestion, where partial output is useless.
   */
  async chat(request: ChatRequest): Promise<OllamaChatResult> {
    const stream = typeof request.onToken === 'function';
    const response = await this.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream,
          // Reasoning models (e.g. gemma4) otherwise spend the whole num_predict budget on a
          // hidden <thinking> pass, leaving `message.content` empty -- this app has nowhere to
          // show a thinking trace and no UI concept of it, so it's always off.
          think: false,
          ...(request.options ? { options: request.options } : {}),
        }),
        signal: request.signal,
      },
      CHAT_TIMEOUT_MS
    );

    if (!stream) {
      const data = (await response.json()) as OllamaChatChunk;
      return {
        content: data.message?.content ?? '',
        promptEvalCount: data.prompt_eval_count ?? null,
        evalCount: data.eval_count ?? null,
      };
    }

    let content = '';
    let promptEvalCount: number | null = null;
    let evalCount: number | null = null;

    for await (const chunk of readNdjson<OllamaChatChunk>(response)) {
      if (chunk.error) {
        throw new OllamaUnavailableError(this.host, chunk.error);
      }
      const delta = chunk.message?.content ?? '';
      if (delta) {
        content += delta;
        request.onToken!(delta);
      }
      // Counts only appear on the terminal chunk.
      if (chunk.done) {
        promptEvalCount = chunk.prompt_eval_count ?? null;
        evalCount = chunk.eval_count ?? null;
      }
    }

    return { content, promptEvalCount, evalCount };
  }

  /**
   * Embeddings for memory retrieval. This replaces KVGenius's in-process
   * sentence-transformers model, which also removes the torch dependency and the
   * Blackwell/sm_120 SDPA workaround its semantic_index.py had to carry.
   */
  async embed(model: string, input: string[], signal?: AbortSignal): Promise<number[][]> {
    if (input.length === 0) return [];
    const response = await this.request(
      '/api/embed',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input }),
        signal,
      },
      CHAT_TIMEOUT_MS
    );
    const data = (await response.json()) as { embeddings?: number[][] };
    return data.embeddings ?? [];
  }

  /** Asks the server to drop a model from VRAM. Best-effort: never throws. */
  async unloadModel(tag: string): Promise<void> {
    try {
      await this.request(
        '/api/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: tag, prompt: '', keep_alive: 0 }),
        },
        REQUEST_TIMEOUT_MS
      );
    } catch {
      // Unloading is an optimisation; failing to do it changes nothing the user sees.
    }
  }

  /** Downloads a model, reporting progress from the NDJSON stream. */
  async pull(
    tag: string,
    onProgress?: (fraction: number, status: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await this.request(
      '/api/pull',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: tag, stream: true }),
        signal,
      },
      PULL_TIMEOUT_MS
    );

    for await (const event of readNdjson<OllamaPullChunk>(response)) {
      if (event.error) {
        throw new OllamaUnavailableError(this.host, event.error);
      }
      const status = event.status ?? '';
      if (event.total && event.completed != null) {
        onProgress?.(Math.min(event.completed / event.total, 1), status);
      } else {
        onProgress?.(0, status);
      }
    }
  }
}

/** Raw shape of one entry in /api/tags -- see listModelsDetailed. */
interface OllamaTagsModel {
  name?: string;
  model?: string;
  size?: number;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    context_length?: number;
  };
  capabilities?: string[];
}

interface OllamaChatChunk {
  message?: { role?: string; content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

interface OllamaPullChunk {
  status?: string;
  total?: number;
  completed?: number;
  error?: string;
}

/** `llama3` and `llama3:latest` name the same model; anything else must match exactly. */
export function equivalentTags(a: string, b: string): boolean {
  const normalise = (tag: string) => (tag.includes(':') ? tag : `${tag}:latest`);
  return normalise(a) === normalise(b);
}

/**
 * Yields parsed objects from a newline-delimited JSON response body.
 *
 * Chunk boundaries do not respect line boundaries, so a partial line is carried over rather
 * than parsed -- getting this wrong produces intermittent JSON errors only under load, which
 * is the worst kind of bug to find later.
 */
export async function* readNdjson<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) return;

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes as Uint8Array, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }

  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as T;
}
