import { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { CharacterImage } from '../../shared/types/characterImage';
import { saveDatabase } from './schema';

function rowToImage(columns: string[], row: any[]): CharacterImage {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    characterId: obj.characterId,
    path: obj.path,
    position: obj.position,
    createdAt: obj.createdAt,
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
  constructor(private db: Database) {}

  getImagesByCharacter(characterId: string): CharacterImage[] {
    const stmt = this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM character_images WHERE character_id = ? ORDER BY position`
    );
    stmt.bind([characterId]);
    const images: CharacterImage[] = [];
    while (stmt.step()) {
      images.push(rowToImage(stmt.getColumnNames(), stmt.get()));
    }
    stmt.free();
    return images;
  }

  /** All images for all characters in one round trip, grouped by character id -- used by the
   * character list so it isn't doing one query per tile. */
  getAllGroupedByCharacter(): Record<string, CharacterImage[]> {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM character_images ORDER BY character_id, position`);
    const grouped: Record<string, CharacterImage[]> = {};
    while (stmt.step()) {
      const image = rowToImage(stmt.getColumnNames(), stmt.get());
      (grouped[image.characterId] ??= []).push(image);
    }
    stmt.free();
    return grouped;
  }

  getImageById(id: string): CharacterImage | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM character_images WHERE id = ?`);
    stmt.bind([id]);
    const image = stmt.step() ? rowToImage(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return image;
  }

  /** Appends an image to the end of a character's gallery. */
  addImage(characterId: string, path: string): CharacterImage {
    const id = uuidv4();
    const now = new Date().toISOString();
    const existing = this.getImagesByCharacter(characterId);
    const nextPosition = existing.length === 0 ? 0 : Math.max(...existing.map((i) => i.position)) + 1;

    this.db.run(
      `INSERT INTO character_images (id, character_id, path, position, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, characterId, path, nextPosition, now]
    );

    saveDatabase(this.db);

    return this.getImageById(id)!;
  }

  removeImage(id: string): void {
    this.db.run(`DELETE FROM character_images WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }
}
