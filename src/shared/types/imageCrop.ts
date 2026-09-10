/** Which owning gallery an image row belongs to -- character_images, persona_images, or
 * scenario_images. Not strictly required for correctness (uuids don't collide across the three
 * tables) but keeps crop rows self-describing for debugging, same spirit as the table
 * discriminator convention already used elsewhere in this schema. */
export type ImageCropOwner = 'character' | 'persona' | 'scenario';

/** Every real place a portrait image is displayed that's worth its own independent crop. Tiny
 * selection affordances (the image picker grid, the chat-start dropdown thumbs) and the
 * full-size lightbox are deliberately not here -- see CLAUDE.md's image-crop scope note. */
export type ImageCropLocation =
  | 'card' // character/persona list tile
  | 'detail' // character/persona big detail-page portrait
  | 'chatAvatar' // chat message bubble avatar
  | 'chatStart' // chat start-screen bubble
  | 'chatMargin' // chat page side-margin portrait
  | 'scenarioThumb'; // scenario's own gallery thumb in ScenarioEditor

/** One image's stored pan/zoom for one display location. Missing (no row) means the default --
 * zoom 1, centered -- which renders identically to plain `object-fit: cover`. */
export interface ImageCrop {
  id: string;
  imageId: string;
  imageOwner: ImageCropOwner;
  location: ImageCropLocation;
  /** 1.0 - 4.0 (100% - 400%). */
  zoom: number;
  /** 0 - 100 (%), the focal point object-position pans/zooms around. */
  offsetX: number;
  offsetY: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_IMAGE_CROP = { zoom: 1, offsetX: 50, offsetY: 50 } as const;

export interface SetImageCropInput {
  imageId: string;
  imageOwner: ImageCropOwner;
  location: ImageCropLocation;
  zoom: number;
  offsetX: number;
  offsetY: number;
}
