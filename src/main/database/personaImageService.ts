import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { PersonaImage } from '../../shared/types/personaImage';
import { transaction } from './schema';

function rowToImage(row: Record<string, unknown>): PersonaImage {
  return {
    id: row.id as string,
    personaId: row.personaId as string,
    path: row.path as string,
    position: row.position as number,
    createdAt: row.createdAt as string,
  };
}

const SELECT_COLUMNS = `
  id,
  persona_id as personaId,
  path,
  position,
  created_at as createdAt
`;

/** Mirrors CharacterImageService exactly -- same table shape, same position-swap convention
 * for the cover image, just against persona_images/user_personas instead. */
export class PersonaImageService {
  constructor(private db: DatabaseSync) {}

  getImagesByPersona(personaId: string): PersonaImage[] {
    const rows = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM persona_images WHERE persona_id = ? ORDER BY position`)
      .all(personaId);
    return rows.map(rowToImage);
  }

  /** All images for all personas in one round trip, grouped by persona id -- used by the
   * persona list so it isn't doing one query per tile. */
  getAllGroupedByPersona(): Record<string, PersonaImage[]> {
    const rows = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM persona_images ORDER BY persona_id, position`)
      .all();
    const grouped: Record<string, PersonaImage[]> = {};
    for (const row of rows) {
      const image = rowToImage(row);
      (grouped[image.personaId] ??= []).push(image);
    }
    return grouped;
  }

  getImageById(id: string): PersonaImage | null {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM persona_images WHERE id = ?`).get(id);
    return row ? rowToImage(row) : null;
  }

  /** Appends an image to the end of a persona's gallery. */
  addImage(personaId: string, path: string): PersonaImage {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      const existing = this.getImagesByPersona(personaId);
      const nextPosition =
        existing.length === 0 ? 0 : Math.max(...existing.map((i) => i.position)) + 1;

      this.db
        .prepare(
          `INSERT INTO persona_images (id, persona_id, path, position, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, personaId, path, nextPosition, now);

      return this.getImageById(id)!;
    });
  }

  removeImage(id: string): void {
    this.db.prepare(`DELETE FROM persona_images WHERE id = ?`).run(id);
  }

  /** Makes one image the cover (position 0, the one shown on the persona grid tile) by
   * swapping positions with whichever image currently holds position 0. */
  setCoverImage(imageId: string): void {
    const target = this.getImageById(imageId);
    if (!target) throw new Error(`Image ${imageId} not found`);
    if (target.position === 0) return;

    transaction(this.db, () => {
      const current = this.db
        .prepare(`SELECT id FROM persona_images WHERE persona_id = ? AND position = 0`)
        .get(target.personaId) as { id: string } | undefined;

      if (current) {
        this.db.prepare(`UPDATE persona_images SET position = ? WHERE id = ?`).run(target.position, current.id);
      }
      this.db.prepare(`UPDATE persona_images SET position = 0 WHERE id = ?`).run(imageId);
    });
  }
}
