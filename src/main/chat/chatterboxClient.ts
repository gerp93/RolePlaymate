/**
 * Thin HTTP client for a locally-running Chatterbox TTS server
 * (https://github.com/devnen/Chatterbox-TTS-Server). Same shape as OllamaClient: the app
 * loads no model and makes no network calls of its own -- everything here targets a server
 * the user runs on their own machine. Uses global `fetch`, so no dependency.
 *
 * Chat and the library stay fully usable when this server is absent. Callers treat
 * ChatterboxUnavailableError as "no speech this turn", never as a failed reply.
 */
import { CharacterTtsVoice, ChatterboxPredefinedVoice } from '../../shared/types/tts';
import { textForSpeech } from '../../shared/utils/ttsText';
import { File } from 'node:buffer';

export const DEFAULT_CHATTERBOX_HOST = 'http://localhost:8004';

const REQUEST_TIMEOUT_MS = 15_000;
const SPEAK_TIMEOUT_MS = 180_000;

export class ChatterboxUnavailableError extends Error {
  constructor(host: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Chatterbox not reachable at ${host}: ${detail}`);
    this.name = 'ChatterboxUnavailableError';
  }
}

/** The server answered, but this request failed (missing voice file, bad payload, ...).
 * Distinct from unreachable so auto-play can stay silent on a down server without hiding a
 * "that clip isn't there anymore" error. */
export class ChatterboxRequestError extends Error {
  constructor(status: number, body: string) {
    super(body ? `Chatterbox HTTP ${status}: ${body}` : `Chatterbox HTTP ${status}`);
    this.name = 'ChatterboxRequestError';
  }
}

export class ChatterboxCancelledError extends Error {
  constructor() {
    super('Speech generation cancelled');
    this.name = 'ChatterboxCancelledError';
  }
}

export class ChatterboxBusyError extends Error {
  constructor() {
    super('Speech generation already in progress');
    this.name = 'ChatterboxBusyError';
  }
}

export class ChatterboxTimeoutError extends Error {
  constructor() {
    super('Chatterbox took too long to generate speech.');
    this.name = 'ChatterboxTimeoutError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function cloneFilenames(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.replace(/^.*[/\\]/, '').trim())
    .filter(Boolean);
}

export interface ChatterboxAudio {
  mimeType: string;
  bytes: Uint8Array;
}

export class ChatterboxClient {
  private speakAbort: AbortController | null = null;

  constructor(private hostProvider: () => string = () => DEFAULT_CHATTERBOX_HOST) {}

  get host(): string {
    return (this.hostProvider() || DEFAULT_CHATTERBOX_HOST).replace(/\/+$/, '');
  }

  /** Drops the in-flight /tts fetch. Chatterbox may still finish the current GPU job. */
  cancelSpeak(): void {
    this.speakAbort?.abort();
    this.speakAbort = null;
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const host = this.host;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(`${host}${path}`, { ...init, signal });
    } catch (error) {
      if (init.signal?.aborted) throw new ChatterboxCancelledError();
      // AbortSignal.any reports the timeout as AbortError (reason/cause may be TimeoutError),
      // so check the timeout signal itself -- error.name === 'TimeoutError' only holds when
      // that signal was passed through unwrapped.
      if (timeout.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
        throw new ChatterboxTimeoutError();
      }
      throw new ChatterboxUnavailableError(host, error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ChatterboxRequestError(response.status, body);
    }
    return response;
  }

  async listPredefinedVoices(): Promise<ChatterboxPredefinedVoice[]> {
    const response = await this.request('/get_predefined_voices', { method: 'GET' }, REQUEST_TIMEOUT_MS);
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .map((item): ChatterboxPredefinedVoice | null => {
        if (typeof item === 'string' && item.trim()) {
          return { displayName: item, filename: item };
        }
        if (item && typeof item === 'object') {
          const row = item as { display_name?: unknown; filename?: unknown; name?: unknown };
          const filename =
            typeof row.filename === 'string'
              ? row.filename.replace(/^.*[/\\]/, '').trim()
              : '';
          if (!filename) return null;
          const displayName =
            typeof row.display_name === 'string' && row.display_name.trim()
              ? row.display_name
              : typeof row.name === 'string' && row.name.trim()
                ? row.name
                : filename;
          return { displayName, filename };
        }
        return null;
      })
      .filter((v): v is ChatterboxPredefinedVoice => v !== null);
  }

  async listCloneVoices(): Promise<string[]> {
    const response = await this.request('/get_reference_files', { method: 'GET' }, REQUEST_TIMEOUT_MS);
    return cloneFilenames(await response.json());
  }

  async uploadReference(filename: string, bytes: Uint8Array): Promise<string[]> {
    const form = new FormData();
    const type = filename.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
    form.append('files', new File([bytes], filename, { type }));
    const response = await this.request('/upload_reference', { method: 'POST', body: form }, REQUEST_TIMEOUT_MS);
    const data = (await response.json()) as {
      uploaded_files?: unknown;
      all_reference_files?: unknown;
      errors?: unknown;
    };
    const errors = Array.isArray(data.errors)
      ? data.errors.filter((row): row is { filename?: unknown; error?: unknown } => !!row && typeof row === 'object')
      : [];
    if (errors.length > 0) {
      const first = errors[0];
      const message = typeof first.error === 'string' && first.error.trim() ? first.error : 'Upload failed.';
      throw new ChatterboxRequestError(response.status, message);
    }
    const listed = cloneFilenames(data.all_reference_files);
    if (listed.length > 0) return listed;
    const uploaded = cloneFilenames(data.uploaded_files);
    if (uploaded.length > 0) return uploaded;
    return this.listCloneVoices();
  }

  async deleteReference(filename: string): Promise<string[]> {
    const params = new URLSearchParams({ filename });
    const response = await this.request(
      `/delete_reference?${params.toString()}`,
      { method: 'DELETE' },
      REQUEST_TIMEOUT_MS
    );
    const listed = cloneFilenames(
      ((await response.json()) as { all_reference_files?: unknown }).all_reference_files
    );
    return listed.length > 0 ? listed : this.listCloneVoices();
  }

  async getReferenceAudioDir(): Promise<string | null> {
    const response = await this.request('/get_reference_audio_dir', { method: 'GET' }, REQUEST_TIMEOUT_MS);
    const data = (await response.json()) as { path?: unknown };
    return typeof data.path === 'string' && data.path.trim() ? data.path.trim() : null;
  }

  async speak(text: string, voice: CharacterTtsVoice): Promise<ChatterboxAudio> {
    if (this.speakAbort) throw new ChatterboxBusyError();

    const spoken = textForSpeech(text);
    if (!spoken) {
      throw new Error('Nothing to speak after stripping markup');
    }

    const abort = new AbortController();
    this.speakAbort = abort;

    const body: Record<string, unknown> = {
      text: spoken,
      voice_mode: voice.mode,
      output_format: 'wav',
      split_text: true,
    };
    if (voice.mode === 'predefined') {
      body.predefined_voice_id = voice.id;
    } else {
      body.reference_audio_filename = voice.id;
    }

    try {
      const response = await this.request(
        '/tts',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abort.signal,
        },
        SPEAK_TIMEOUT_MS
      );

      const buffer = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/wav';
      return { mimeType, bytes: new Uint8Array(buffer) };
    } catch (error) {
      if (abort.signal.aborted) throw new ChatterboxCancelledError();
      if (isAbortError(error) && error instanceof Error && error.name === 'TimeoutError') {
        throw new ChatterboxTimeoutError();
      }
      throw error;
    } finally {
      if (this.speakAbort === abort) this.speakAbort = null;
    }
  }
}
