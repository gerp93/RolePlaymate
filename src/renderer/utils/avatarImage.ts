import { ImageMode } from '../../shared/types/conversation';

interface Image {
  id: string;
  path: string;
  position: number;
}

/** The gallery's cover image (position 0), or just the first entry if positions are somehow
 * out of order, or null if there's no gallery at all. */
function coverImage<T extends Image>(images: T[]): T | null {
  if (images.length === 0) return null;
  return images.find((i) => i.position === 0) ?? images[0];
}

/** A message bubble's small avatar always shows the gallery's cover image -- no per-message
 * variation, regardless of the conversation's carousel/static mode (that only governs the
 * large margin portraits, see resolveMarginImage below). */
export function resolveCoverImage<T extends Image>(images: T[]): T | null {
  return coverImage(images);
}

/**
 * Which image the large margin portrait should show right now.
 *
 * - No images at all -> null (caller renders nothing/a placeholder).
 * - `static` -> the pinned image, falling back to the cover if the pinned id is missing/was
 *   since deleted.
 * - `carousel` -> steps through the gallery in order, one image per `tick` -- Chat.tsx
 *   increments `tick` on a 10-second interval, shared across both the character and persona
 *   side so they change on the same beat even if their galleries are different sizes.
 */
export function resolveMarginImage<T extends Image>(
  images: T[],
  mode: ImageMode,
  staticId: string | null,
  tick: number
): T | null {
  if (images.length === 0) return null;

  if (mode === 'static') {
    const pinned = staticId ? images.find((i) => i.id === staticId) : undefined;
    return pinned ?? coverImage(images);
  }

  return images[tick % images.length];
}
