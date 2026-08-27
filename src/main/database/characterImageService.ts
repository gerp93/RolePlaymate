import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { CharacterImage } from '../../shared/types/characterImage';
import { transaction } from './schema';

function rowToImage(row: Record<string, unknown>): CharacterImage {
  return {
    id: row.id as string,
    characterId: row.characterId as string,
    path: row.path as string,
    position: row.position as number,
    createdAt: row.createdAt as string,
  };
}

const SELECT_COLUMNS = `
  id,
  character_id as characterId,
  path,
  position,
  created_at as createdAt
`;

export class CharacterImageService {
  constructor(private db: DatabaseSync) {}

  getImagesByCharacter(characterId: string): CharacterImage[] {
    const rows = this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM character_images WHERE character_id = ? ORDER BY position`
      )
      .all(characterId);
    return rows.map(rowToImage);
  }

  /** All images for all characters in one round trip, grouped by character id -- used by the
   * character list so it isn't doing one query per tile. */
  getAllGroupedByCharacter(): Record<string, CharacterImage[]> {
    const rows = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM character_images ORDER BY character_id, position`)
      .all();
    const grouped: Record<string, CharacterImage[]> = {};
    for (const row of rows) {
      const image = rowToImage(row);
      (grouped[image.characterId] ??= []).push(image);
    }
    return grouped;
  }

  getImageById(id: string): CharacterImage | null {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM character_images WHERE id = ?`).get(id);
    return row ? rowToImage(row) : null;
  }

  /** Appends an image to the end of a character's gallery. */
  addImage(characterId: string, path: string): CharacterImage {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      const existing = this.getImagesByCharacter(characterId);
      const nextPosition =
        existing.length === 0 ? 0 : Math.max(...existing.map((i) => i.position)) + 1;

      this.db
        .prepare(
          `INSERT INTO character_images (id, character_id, path, position, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, characterId, path, nextPosition, now);

      return this.getImageById(id)!;
    });
  }

  removeImage(id: string): void {
    this.db.prepare(`DELETE FROM character_images WHERE id = ?`).run(id);
  }

  /** Makes one image the cover (position 0, the one shown on the character grid tile) by
   * swapping positions with whichever image currently holds position 0. Simpler than
   * resequencing the whole gallery, and it preserves the relative order of every other image. */
  setCoverImage(imageId: string): void {
    const target = this.getImageById(imageId);
    if (!target) throw new Error(`Image ${imageId} not found`);
    if (target.position === 0) return;

    transaction(this.db, () => {
      const current = this.db
        .prepare(`SELECT id FROM character_images WHERE character_id = ? AND position = 0`)
        .get(target.characterId) as { id: string } | undefined;

      if (current) {
        this.db.prepare(`UPDATE character_images SET position = ? WHERE id = ?`).run(target.position, current.id);
      }
      this.db.prepare(`UPDATE character_images SET position = 0 WHERE id = ?`).run(imageId);
    });
  }
}
