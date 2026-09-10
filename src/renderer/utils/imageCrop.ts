import type { CSSProperties } from 'react';
import { ImageCrop } from '../../shared/types/imageCrop';

/** Turns a stored crop into the inline style that reproduces it. Containers at every display
 * site already set `object-fit: cover` and `overflow: hidden` via their own CSS class, so this
 * only needs to override `object-position` (the pan) and add a `scale()` transform anchored at
 * the same point (the zoom) -- the container clips the rest. No stored crop (or zoom 1,
 * centered) renders identically to the plain `object-fit: cover` every image used before this
 * feature existed. */
export function cropStyle(crop?: Pick<ImageCrop, 'zoom' | 'offsetX' | 'offsetY'> | null): CSSProperties {
  const zoom = crop?.zoom ?? 1;
  const offsetX = crop?.offsetX ?? 50;
  const offsetY = crop?.offsetY ?? 50;
  return {
    objectPosition: `${offsetX}% ${offsetY}%`,
    transform: `scale(${zoom})`,
    transformOrigin: `${offsetX}% ${offsetY}%`,
  };
}
