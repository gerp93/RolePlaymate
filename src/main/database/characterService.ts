import { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { Character, CreateCharacterInput, UpdateCharacterInput } from '../../shared/types/character';
import { saveDatabase } from './schema';

function rowToCharacter(columns: string[], row: any[]): Character {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    name: obj.name,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
  name,
  created_at as createdAt,
  updated_at as updatedAt
`;

export class CharacterService {
  constructor(private db: Database) {}

  getAllCharacters(): Character[] {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM characters ORDER BY updated_at DESC`);
    const characters: Character[] = [];
    while (stmt.step()) {
      characters.push(rowToCharacter(stmt.getColumnNames(), stmt.get()));
    }
    stmt.free();
    return characters;
  }

  getCharacterById(id: string): Character | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM characters WHERE id = ?`);
    stmt.bind([id]);
    const character = stmt.step() ? rowToCharacter(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return character;
  }

  createCharacter(input: CreateCharacterInput): Character {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(`INSERT INTO characters (id, name, image_url, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)`, [
      id,
      input.name,
      now,
      now,
    ]);

    saveDatabase(this.db);

    return this.getCharacterById(id)!;
  }

  updateCharacter(id: string, input: UpdateCharacterInput): Character {
    const existing = this.getCharacterById(id);
    if (!existing) {
      throw new Error(`Character with id ${id} not found`);
    }

    const now = new Date().toISOString();
    this.db.run(`UPDATE characters SET name = ?, updated_at = ? WHERE id = ?`, [
      input.name ?? existing.name,
      now,
      id,
    ]);

    saveDatabase(this.db);

    return this.getCharacterById(id)!;
  }

  /** Cascades to character_fields, character_field_versions, and character_images (enforced
   * in service code -- see schema.ts's note on sql.js not actually honoring ON DELETE CASCADE). */
  deleteCharacter(id: string): void {
    const fieldStmt = this.db.prepare(`SELECT id FROM character_fields WHERE character_id = ?`);
    fieldStmt.bind([id]);
    const fieldIds: string[] = [];
    while (fieldStmt.step()) {
      fieldIds.push(fieldStmt.get()[0] as string);
    }
    fieldStmt.free();

    for (const fieldId of fieldIds) {
      this.db.run(`DELETE FROM character_field_versions WHERE field_id = ?`, [fieldId]);
    }
    this.db.run(`DELETE FROM character_fields WHERE character_id = ?`, [id]);
    this.db.run(`DELETE FROM character_images WHERE character_id = ?`, [id]);
    this.db.run(`DELETE FROM characters WHERE id = ?`, [id]);

    saveDatabase(this.db);
  }
}
