import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { PromptFieldVersion, PromptTemplates, TEMPLATE_FIELD_KEYS } from '../../shared/types/promptTemplates';
import { transaction } from './schema';
import { DEFAULT_TEMPLATES } from '../chat/promptTemplates';

function rowToVersion(row: Record<string, unknown>): PromptFieldVersion {
  return {
    id: row.id as string,
    fieldKey: row.fieldKey as keyof PromptTemplates,
    versionNumber: row.versionNumber as number,
    content: row.content as string,
    isActive: !!row.isActive,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

const SELECT_COLUMNS = `
  pfv.id as id,
  pf.field_key as fieldKey,
  pfv.version_number as versionNumber,
  pfv.content as content,
  pfv.is_active as isActive,
  pfv.created_at as createdAt,
  pfv.updated_at as updatedAt
`;

/**
 * Version history for the 7 system-prompt template fields, mirroring FieldVersionService's
 * shape exactly -- same self-healing active-version invariant, same duplicate/update/delete
 * semantics -- except keyed by the field's fixed `field_key` (a PromptTemplates key) rather
 * than an opaque per-character field id, and with no encryption: prompt templates aren't owned
 * by a character or persona, so they're never subject to the hidden-items PIN.
 */
export class PromptFieldVersionService {
  constructor(private db: DatabaseSync) {}

  private getFieldId(fieldKey: keyof PromptTemplates): string {
    const row = this.db.prepare(`SELECT id FROM prompt_fields WHERE field_key = ?`).get(fieldKey) as
      | { id: string }
      | undefined;
    if (!row) {
      throw new Error(`Unknown prompt field key: ${fieldKey}`);
    }
    return row.id;
  }

  getVersionsByField(fieldKey: keyof PromptTemplates): PromptFieldVersion[] {
    const fieldId = this.getFieldId(fieldKey);
    const rows = this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM prompt_field_versions pfv
         JOIN prompt_fields pf ON pf.id = pfv.field_id
         WHERE pfv.field_id = ? ORDER BY pfv.version_number`
      )
      .all(fieldId)
      .map(rowToVersion);
    return this.ensureLatestIsActive(fieldId, rows);
  }

  /** Same self-heal as FieldVersionService.ensureLatestIsActive -- keeps "active" and "latest"
   * in sync even if some future write path forgets to. */
  private ensureLatestIsActive(fieldId: string, versions: PromptFieldVersion[]): PromptFieldVersion[] {
    if (versions.length === 0) return versions;
    const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
    if (latest.isActive) return versions;

    const now = new Date().toISOString();
    transaction(this.db, () => {
      this.db
        .prepare(`UPDATE prompt_field_versions SET is_active = 0, updated_at = ? WHERE field_id = ? AND is_active = 1`)
        .run(now, fieldId);
      this.db.prepare(`UPDATE prompt_field_versions SET is_active = 1, updated_at = ? WHERE id = ?`).run(now, latest.id);
    });

    return versions.map((v) => ({ ...v, isActive: v.id === latest.id }));
  }

  getVersionById(id: string): PromptFieldVersion | null {
    const row = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM prompt_field_versions pfv JOIN prompt_fields pf ON pf.id = pfv.field_id WHERE pfv.id = ?`)
      .get(id);
    return row ? rowToVersion(row) : null;
  }

  /** "Save as New Version" -- copies the current active content into a new, always-active row. */
  duplicateVersion(versionId: string): PromptFieldVersion {
    const source = this.getVersionById(versionId);
    if (!source) {
      throw new Error(`PromptFieldVersion with id ${versionId} not found`);
    }
    return this.insertNewActiveVersion(source.fieldKey, source.content);
  }

  updateVersionContent(id: string, content: string): PromptFieldVersion {
    const existing = this.getVersionById(id);
    if (!existing) {
      throw new Error(`PromptFieldVersion with id ${id} not found`);
    }
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE prompt_field_versions SET content = ?, updated_at = ? WHERE id = ?`).run(content, now, id);
    return this.getVersionById(id)!;
  }

  /** Blocked if it's the field's only version. If it was active, promotes the most recent remaining version. */
  deleteVersion(id: string): void {
    const existing = this.getVersionById(id);
    if (!existing) return;

    const siblings = this.getVersionsByField(existing.fieldKey);
    if (siblings.length <= 1) {
      throw new Error("Cannot delete a field's only version");
    }

    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM prompt_field_versions WHERE id = ?`).run(id);

      if (existing.isActive) {
        const remaining = siblings.filter((v) => v.id !== id);
        const mostRecent = remaining.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
        const now = new Date().toISOString();
        this.db.prepare(`UPDATE prompt_field_versions SET is_active = 1, updated_at = ? WHERE id = ?`).run(now, mostRecent.id);
      }
    });
  }

  /** Inserts a new version holding the field's built-in default text, becoming active -- NOT a
   * revert, so any edited version currently in history stays in history untouched. */
  resetToDefault(fieldKey: keyof PromptTemplates): PromptFieldVersion {
    return this.insertNewActiveVersion(fieldKey, DEFAULT_TEMPLATES[fieldKey]);
  }

  private insertNewActiveVersion(fieldKey: keyof PromptTemplates, content: string): PromptFieldVersion {
    const fieldId = this.getFieldId(fieldKey);
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      const existing = this.getVersionsByField(fieldKey);
      const nextVersionNumber = Math.max(...existing.map((v) => v.versionNumber)) + 1;

      this.db
        .prepare(`UPDATE prompt_field_versions SET is_active = 0, updated_at = ? WHERE field_id = ? AND is_active = 1`)
        .run(now, fieldId);
      this.db
        .prepare(
          `INSERT INTO prompt_field_versions (id, field_id, version_number, content, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, fieldId, nextVersionNumber, content, now, now);

      return this.getVersionById(id)!;
    });
  }

  /** All 7 fields' currently-active content at once, for PromptBuilder -- the DB always has an
   * active version per field once seedPromptFields has run, so this is the complete effective
   * template set with no separate defaults-merge needed. */
  getActiveTemplates(): PromptTemplates {
    const result = {} as PromptTemplates;
    for (const fieldKey of TEMPLATE_FIELD_KEYS) {
      const versions = this.getVersionsByField(fieldKey);
      const active = versions.find((v) => v.isActive);
      result[fieldKey] = active?.content ?? DEFAULT_TEMPLATES[fieldKey];
    }
    return result;
  }
}
