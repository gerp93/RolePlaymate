import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { CharacterField, FieldType } from '../../shared/types/characterField';

function rowToField(row: Record<string, unknown>): CharacterField {
  return {
    id: row.id as string,
    characterId: row.characterId as string,
    fieldType: row.fieldType as FieldType,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
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
  constructor(private db: DatabaseSync) {}

  getFieldsByCharacter(characterId: string): CharacterField[] {
    const rows = this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM character_fields WHERE character_id = ? ORDER BY field_type`
      )
      .all(characterId);
    return rows.map(rowToField);
  }

  getFieldById(id: string): CharacterField | null {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM character_fields WHERE id = ?`).get(id);
    return row ? rowToField(row) : null;
  }

  /** Blank content record for one field type. Caller (characters:create IPC handler) also
   * creates its first CharacterFieldVersion -- mirrors TrackDraft's parts.create + partVersions.create pairing. */
  createField(characterId: string, fieldType: FieldType): CharacterField {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO character_fields (id, character_id, field_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, characterId, fieldType, now, now);

    return this.getFieldById(id)!;
  }
}
