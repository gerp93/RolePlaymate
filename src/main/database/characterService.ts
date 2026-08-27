import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { Character, CreateCharacterInput, UpdateCharacterInput } from '../../shared/types/character';

/** Rows come back keyed by the SELECT_COLUMNS aliases, so this only has to fix up what SQL
 * can't express -- here, NULL vs undefined for the optional description. */
function rowToCharacter(row: Record<string, unknown>): Character {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

const SELECT_COLUMNS = `
  id,
  name,
  description,
  created_at as createdAt,
  updated_at as updatedAt
`;

export class CharacterService {
  constructor(private db: DatabaseSync) {}

  getAllCharacters(): Character[] {
    const rows = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM characters ORDER BY updated_at DESC`)
      .all();
    return rows.map(rowToCharacter);
  }

  getCharacterById(id: string): Character | null {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM characters WHERE id = ?`).get(id);
    return row ? rowToCharacter(row) : null;
  }

  createCharacter(input: CreateCharacterInput): Character {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO characters (id, name, image_url, description, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)`
      )
      .run(id, input.name, input.description ?? null, now, now);

    return this.getCharacterById(id)!;
  }

  updateCharacter(id: string, input: UpdateCharacterInput): Character {
    const existing = this.getCharacterById(id);
    if (!existing) {
      throw new Error(`Character with id ${id} not found`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE characters SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
      .run(input.name ?? existing.name, input.description ?? existing.description, now, id);

    return this.getCharacterById(id)!;
  }

  /** Cascades to character_fields, character_field_versions, and character_images via the
   * schema's ON DELETE CASCADE constraints, which are enforced now that foreign keys are on.
   * Note this removes the image *rows* but not the files on disk -- callers that care fetch
   * the paths before deleting and unlink them (see the characters:delete IPC handler). */
  deleteCharacter(id: string): void {
    this.db.prepare(`DELETE FROM characters WHERE id = ?`).run(id);
  }
}
