import { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { CharacterFieldVersion, CreateFieldVersionInput } from '../../shared/types/fieldVersion';
import { saveDatabase } from './schema';

function rowToFieldVersion(columns: string[], row: any[]): CharacterFieldVersion {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    fieldId: obj.fieldId,
    versionNumber: obj.versionNumber,
    content: obj.content,
    isActive: !!obj.isActive,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
  field_id as fieldId,
  version_number as versionNumber,
  content,
  is_active as isActive,
  created_at as createdAt,
  updated_at as updatedAt
`;

export class FieldVersionService {
  constructor(private db: Database) {}

  getVersionsByField(fieldId: string): CharacterFieldVersion[] {
    const stmt = this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM character_field_versions WHERE field_id = ? ORDER BY version_number`
    );
    stmt.bind([fieldId]);
    const versions: CharacterFieldVersion[] = [];
    while (stmt.step()) {
      versions.push(rowToFieldVersion(stmt.getColumnNames(), stmt.get()));
    }
    stmt.free();
    return this.ensureLatestIsActive(fieldId, versions);
  }

  /** Self-heals rows written before active-always-tracks-latest was enforced at write time
   * (or any other drift) -- every read re-checks the invariant instead of trusting history. */
  private ensureLatestIsActive(fieldId: string, versions: CharacterFieldVersion[]): CharacterFieldVersion[] {
    if (versions.length === 0) return versions;
    const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
    if (latest.isActive) return versions;

    const now = new Date().toISOString();
    this.db.run(
      `UPDATE character_field_versions SET is_active = 0, updated_at = ? WHERE field_id = ? AND is_active = 1`,
      [now, fieldId]
    );
    this.db.run(`UPDATE character_field_versions SET is_active = 1, updated_at = ? WHERE id = ?`, [now, latest.id]);
    saveDatabase(this.db);

    return versions.map((v) => ({ ...v, isActive: v.id === latest.id }));
  }

  getVersionById(id: string): CharacterFieldVersion | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM character_field_versions WHERE id = ?`);
    stmt.bind([id]);
    const version = stmt.step() ? rowToFieldVersion(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return version;
  }

  /** Blank version; auto-activates only if it's the field's first version. */
  createVersion(input: CreateFieldVersionInput): CharacterFieldVersion {
    const id = uuidv4();
    const now = new Date().toISOString();
    const existing = this.getVersionsByField(input.fieldId);
    const nextVersionNumber = existing.length === 0 ? 1 : Math.max(...existing.map((v) => v.versionNumber)) + 1;
    const isFirst = existing.length === 0;

    this.db.run(
      `INSERT INTO character_field_versions (id, field_id, version_number, content, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.fieldId, nextVersionNumber, input.content ?? '', isFirst ? 1 : 0, now, now]
    );

    saveDatabase(this.db);

    return this.getVersionById(id)!;
  }

  /** "Save as new version" -- copies content into a new, always-active version. Active and
   * latest are the same concept in this app (only the latest is editable), so whatever you
   * just duplicated to becomes the one in effect immediately. */
  duplicateVersion(versionId: string): CharacterFieldVersion {
    const source = this.getVersionById(versionId);
    if (!source) {
      throw new Error(`CharacterFieldVersion with id ${versionId} not found`);
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const existing = this.getVersionsByField(source.fieldId);
    const nextVersionNumber = Math.max(...existing.map((v) => v.versionNumber)) + 1;

    // Deactivate the current active row first -- the partial unique index on is_active=1
    // would reject inserting a second active row otherwise.
    this.db.run(
      `UPDATE character_field_versions SET is_active = 0, updated_at = ? WHERE field_id = ? AND is_active = 1`,
      [now, source.fieldId]
    );
    this.db.run(
      `INSERT INTO character_field_versions (id, field_id, version_number, content, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [id, source.fieldId, nextVersionNumber, source.content, now, now]
    );

    saveDatabase(this.db);

    return this.getVersionById(id)!;
  }

  updateVersionContent(id: string, content: string): CharacterFieldVersion {
    const existing = this.getVersionById(id);
    if (!existing) {
      throw new Error(`CharacterFieldVersion with id ${id} not found`);
    }

    const now = new Date().toISOString();
    this.db.run(`UPDATE character_field_versions SET content = ?, updated_at = ? WHERE id = ?`, [content, now, id]);
    saveDatabase(this.db);

    return this.getVersionById(id)!;
  }

  /** Blocked if it's the field's only version. If it was active, promotes the most recent remaining version. */
  deleteVersion(id: string): void {
    const existing = this.getVersionById(id);
    if (!existing) return;

    const siblings = this.getVersionsByField(existing.fieldId);
    if (siblings.length <= 1) {
      throw new Error("Cannot delete a field's only version");
    }

    this.db.run(`DELETE FROM character_field_versions WHERE id = ?`, [id]);

    if (existing.isActive) {
      const remaining = siblings.filter((v) => v.id !== id);
      const mostRecent = remaining.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
      const now = new Date().toISOString();
      this.db.run(`UPDATE character_field_versions SET is_active = 1, updated_at = ? WHERE id = ?`, [
        now,
        mostRecent.id,
      ]);
    }

    saveDatabase(this.db);
  }
}
