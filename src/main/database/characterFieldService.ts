import { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { CharacterField, FieldType } from '../../shared/types/characterField';
import { saveDatabase } from './schema';

function rowToField(columns: string[], row: any[]): CharacterField {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    characterId: obj.characterId,
    fieldType: obj.fieldType as FieldType,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
  character_id as characterId,
  field_type as fieldType,
  created_at as createdAt,
  updated_at as updatedAt
`;

export class CharacterFieldService {
  constructor(private db: Database) {}

  getFieldsByCharacter(characterId: string): CharacterField[] {
    const stmt = this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM character_fields WHERE character_id = ? ORDER BY field_type`
    );
    stmt.bind([characterId]);
    const fields: CharacterField[] = [];
    while (stmt.step()) {
      fields.push(rowToField(stmt.getColumnNames(), stmt.get()));
    }
    stmt.free();
    return fields;
  }

  getFieldById(id: string): CharacterField | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM character_fields WHERE id = ?`);
    stmt.bind([id]);
    const field = stmt.step() ? rowToField(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return field;
  }

  /** Blank content record for one field type. Caller (characters:create IPC handler) also
   * creates its first CharacterFieldVersion -- mirrors TrackDraft's parts.create + partVersions.create pairing. */
  createField(characterId: string, fieldType: FieldType): CharacterField {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO character_fields (id, character_id, field_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, characterId, fieldType, now, now]
    );

    saveDatabase(this.db);

    return this.getFieldById(id)!;
  }
}
