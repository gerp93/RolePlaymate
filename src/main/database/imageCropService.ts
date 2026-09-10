import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { ImageCrop, ImageCropLocation, ImageCropOwner } from '../../shared/types/imageCrop';
import { transaction } from './schema';

function rowToImageCrop(row: Record<string, unknown>): ImageCrop {
  return {
    id: row.id as string,
    imageId: row.imageId as string,
    imageOwner: row.imageOwner as ImageCropOwner,
    location: row.location as ImageCropLocation,
    zoom: row.zoom as number,
    offsetX: row.offsetX as number,
    offsetY: row.offsetY as number,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

const SELECT_COLUMNS = `
  id,
  image_id as imageId,
  image_owner as imageOwner,
  location,
  zoom,
  offset_x as offsetX,
  offset_y as offsetY,
  created_at as createdAt,
  updated_at as updatedAt
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Per-(image, display location) pan/zoom -- see the `image_crops` table comment in schema.ts
 * for why this is keyed on both rather than one crop per image, and why cleanup here is
 * explicit rather than an ON DELETE CASCADE.
 */
export class ImageCropService {
  constructor(private db: DatabaseSync) {}

  /** Bulk fetch (one query) for a page showing many images at once, e.g. a list grid. */
  getCropsForImages(imageIds: string[]): ImageCrop[] {
    if (imageIds.length === 0) return [];
    const placeholders = imageIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM image_crops WHERE image_id IN (${placeholders})`)
      .all(...imageIds);
    return rows.map(rowToImageCrop);
  }

  /** Upsert -- clamps to sane ranges so a stray value (e.g. a wheel event firing past the UI's
   * own slider bounds) can never store something that would render the image invisible or
   * absurdly zoomed. */
  setCrop(input: {
    imageId: string;
    imageOwner: ImageCropOwner;
    location: ImageCropLocation;
    zoom: number;
    offsetX: number;
    offsetY: number;
  }): ImageCrop {
    const id = uuidv4();
    const now = new Date().toISOString();
    const zoom = clamp(input.zoom, 1, 4);
    const offsetX = clamp(input.offsetX, 0, 100);
    const offsetY = clamp(input.offsetY, 0, 100);

    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO image_crops (id, image_id, image_owner, location, zoom, offset_x, offset_y, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (image_id, location) DO UPDATE SET
             zoom = excluded.zoom,
             offset_x = excluded.offset_x,
             offset_y = excluded.offset_y,
             updated_at = excluded.updated_at`
        )
        .run(id, input.imageId, input.imageOwner, input.location, zoom, offsetX, offsetY, now, now);

      const row = this.db
        .prepare(`SELECT ${SELECT_COLUMNS} FROM image_crops WHERE image_id = ? AND location = ?`)
        .get(input.imageId, input.location)!;
      return rowToImageCrop(row);
    });
  }

  /** Deletes the stored crop, falling back to the default (zoom 1, centered). */
  resetCrop(imageId: string, location: ImageCropLocation): void {
    this.db.prepare(`DELETE FROM image_crops WHERE image_id = ? AND location = ?`).run(imageId, location);
  }

  deleteCropsForImage(imageId: string): void {
    this.db.prepare(`DELETE FROM image_crops WHERE image_id = ?`).run(imageId);
  }

  deleteCropsForImages(imageIds: string[]): void {
    if (imageIds.length === 0) return;
    const placeholders = imageIds.map(() => '?').join(', ');
    this.db.prepare(`DELETE FROM image_crops WHERE image_id IN (${placeholders})`).run(...imageIds);
  }
}
