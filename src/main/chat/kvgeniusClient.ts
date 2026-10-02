import * as fs from 'fs';
import * as path from 'path';

/**
 * Thin `fetch` client for KVGenius's local control API -- the same one its MCP stdio shim
 * wraps (`POST /v1/tools/<name>` with the tool's arguments, bearer token, loopback only).
 * RolePlaymate is not an MCP client, so it skips the shim and talks to that API directly.
 *
 * While KVGenius's "Other Apps (MCP)" toggle is on it writes `mcp-api.json` (port + token) into
 * its own userData folder; the file is read on every call so a KVGenius restart (new port, new
 * pid) needs no reconfiguration here. The token never leaves the main process.
 *
 * KVGenius only lets a client see what that client created, which suits this feature: we only
 * ever ask about jobs and items we submitted ourselves.
 */

interface Discovery {
  port: number;
  token: string;
}

export class KvgeniusError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'KvgeniusError';
  }
}

export interface KvgeniusItem {
  id: string;
  kind: 'image' | 'video' | 'audio';
  path: string;
  width: number | null;
  height: number | null;
}

export type KvgeniusJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface KvgeniusJob {
  job_id: number;
  status: KvgeniusJobStatus;
  error: string | null;
  item: KvgeniusItem | null;
}

const TERMINAL: KvgeniusJobStatus[] = ['done', 'failed', 'cancelled', 'interrupted'];
/** get_job's own cap on wait_seconds is 60; stay under it so the HTTP call never outlives it. */
const POLL_WAIT_SECONDS = 20;
const REQUEST_TIMEOUT_MS = 15_000;
/** Label KVGenius groups our jobs under, so they are easy to find (and clear) over there. */
export const KVGENIUS_BATCH = 'roleplaymate';

export class KvgeniusClient {
  /** `discoveryFiles` are tried in order; the first that exists and parses wins. */
  constructor(private readonly discoveryFiles: () => string[]) {}

  private readDiscovery(): Discovery {
    for (const file of this.discoveryFiles()) {
      try {
        const info = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<Discovery>;
        if (typeof info.port === 'number' && typeof info.token === 'string') {
          return { port: info.port, token: info.token };
        }
      } catch {
        // missing or half-written; try the next candidate
      }
    }
    throw new KvgeniusError(
      'not_running',
      'KVGenius is not reachable. Open KVGenius and turn on Settings → Other Apps (MCP).'
    );
  }

  private async call<T>(tool: string, args: unknown, signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const { port, token } = this.readDiscovery();
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/v1/tools/${tool}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args ?? {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      // A stale discovery file (KVGenius quit without cleaning up) lands here too.
      throw new KvgeniusError(
        'not_running',
        'KVGenius is not reachable. Open KVGenius and turn on Settings → Other Apps (MCP).'
      );
    }
    const body = (await response.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error: { code: string; message: string } }
      | null;
    if (!body) throw new KvgeniusError('bad_response', `KVGenius returned an unreadable response (HTTP ${response.status}).`);
    if (!body.ok) throw new KvgeniusError(body.error.code, body.error.message);
    return body.data;
  }

  /** Cheap reachability probe for the UI: resolves with a reason when unavailable. */
  async status(): Promise<{ available: true } | { available: false; message: string }> {
    try {
      const caps = await this.call<{ comfyui_reachable?: boolean }>('list_capabilities', {}, undefined, 5_000);
      if (caps.comfyui_reachable === false) {
        return { available: false, message: 'KVGenius is running but ComfyUI is not reachable from it.' };
      }
      return { available: true };
    } catch (error) {
      return { available: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Queues a text-to-image job and returns at once with its id. */
  async submitImage(params: { prompt: string; width: number; height: number }, signal?: AbortSignal): Promise<number> {
    const job = await this.call<KvgeniusJob>('generate_image', { ...params, batch: KVGENIUS_BATCH }, signal);
    return job.job_id;
  }

  /** Waits for a job to reach a terminal state, long-polling so there is no busy loop. */
  async waitForJob(jobId: number, signal?: AbortSignal): Promise<KvgeniusJob> {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const job = await this.call<KvgeniusJob>(
        'get_job',
        { job_id: jobId, wait_seconds: POLL_WAIT_SECONDS },
        signal,
        (POLL_WAIT_SECONDS + 15) * 1000
      );
      if (TERMINAL.includes(job.status)) return job;
    }
  }

  async cancelJob(jobId: number): Promise<void> {
    await this.call('cancel_job', { job_id: jobId }).catch(() => undefined);
  }

  /** The finished image's file path on disk (KVGenius runs on this machine, so it is readable). */
  async getImagePath(itemId: string): Promise<string> {
    const { item, file_exists } = await this.call<{ item: KvgeniusItem; file_exists: boolean }>('get_item', {
      item_id: itemId,
      preview: false,
    });
    if (item.kind !== 'image' || !file_exists || !path.isAbsolute(item.path)) {
      throw new KvgeniusError('file_missing', 'KVGenius no longer has that image on disk.');
    }
    return item.path;
  }
}
