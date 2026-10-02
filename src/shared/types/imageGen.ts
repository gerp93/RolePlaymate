/** Shapes shared by the main process and the renderer for chat's "Generate image" add-on, which
 * drafts a prompt with the chat model and sends it to KVGenius (see main/imageGen.ts). */

export type ImageGenAspect = 'portrait' | 'square' | 'landscape';

export type ImageGenStatus = { available: true } | { available: false; message: string };

export interface ImageGenResult {
  /** Opaque handle for saving this image; the renderer never sees a file path. */
  resultId: string;
  /** The image itself, for preview. */
  dataUrl: string;
  /** The prompt that produced it. */
  prompt: string;
}

export type ImageGenSaveTarget = 'character' | 'persona';
