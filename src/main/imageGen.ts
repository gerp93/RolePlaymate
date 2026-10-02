import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { KvgeniusClient, KvgeniusError } from './chat/kvgeniusClient';
import { ImageGenAspect, ImageGenResult } from '../shared/types/imageGen';

/** Sizes are multiples of 64, which is what KVGenius snaps to anyway. */
const ASPECT_SIZES: Record<ImageGenAspect, { width: number; height: number }> = {
  portrait: { width: 832, height: 1216 },
  square: { width: 1024, height: 1024 },
  landscape: { width: 1216, height: 832 },
};

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Finished images are kept (as a path into KVGenius's own folder) only long enough for the user
 * to decide where to save them. The renderer never names a path: it holds an opaque result id,
 * so it cannot ask the main process to copy an arbitrary file into the library. */
const MAX_REMEMBERED_RESULTS = 12;

/**
 * One in-flight image generation per request id, plus the results awaiting a save. The renderer
 * supplies the request id so it can cancel a call that is still blocking on its own `invoke`
 * (chat is the only feature that pushes events; this one deliberately does not add a second).
 */
export class ImageGenService {
  private readonly inFlight = new Map<string, { abort: AbortController; jobId: number | null }>();
  private readonly results = new Map<string, string>();

  constructor(private readonly client: KvgeniusClient) {}

  status() {
    return this.client.status();
  }

  async generate(requestId: string, prompt: string, aspect: ImageGenAspect): Promise<ImageGenResult> {
    const text = prompt.trim();
    if (!text) throw new Error('Write an image prompt first.');
    const size = ASPECT_SIZES[aspect] ?? ASPECT_SIZES.portrait;

    const entry = { abort: new AbortController(), jobId: null as number | null };
    this.inFlight.set(requestId, entry);
    try {
      entry.jobId = await this.client.submitImage({ prompt: text, ...size }, entry.abort.signal);
      const job = await this.client.waitForJob(entry.jobId, entry.abort.signal);
      if (job.status === 'cancelled') throw new KvgeniusError('cancelled', 'Image generation was cancelled.');
      if (job.status === 'interrupted') {
        throw new KvgeniusError('interrupted', 'KVGenius closed before the image finished. Try again.');
      }
      if (job.status !== 'done' || !job.item) {
        throw new KvgeniusError('failed', job.error ?? 'KVGenius could not generate the image.');
      }

      const file = await this.client.getImagePath(job.item.id);
      const mime = MIME_BY_EXT[path.extname(file).toLowerCase()];
      if (!mime) throw new KvgeniusError('bad_type', 'KVGenius returned a file that is not an image.');
      const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

      const resultId = randomUUID();
      this.results.set(resultId, file);
      while (this.results.size > MAX_REMEMBERED_RESULTS) {
        this.results.delete(this.results.keys().next().value as string);
      }
      return { resultId, dataUrl, prompt: text };
    } catch (error) {
      // The abort came from our own cancel(); report it the same way a KVGenius-side cancel is.
      if (entry.abort.signal.aborted) throw new KvgeniusError('cancelled', 'Image generation was cancelled.');
      throw error;
    } finally {
      this.inFlight.delete(requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    const entry = this.inFlight.get(requestId);
    if (!entry) return;
    entry.abort.abort();
    // Aborting only stops our waiting; the job itself would keep the GPU busy.
    if (entry.jobId !== null) await this.client.cancelJob(entry.jobId);
  }

  /** Where a finished result lives on disk, for the save step. Throws for an unknown/expired id. */
  resultPath(resultId: string): string {
    const file = this.results.get(resultId);
    if (!file || !fs.existsSync(file)) {
      throw new Error('That image is no longer available. Generate it again.');
    }
    return file;
  }
}
