import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { CharacterFieldVersion, CreateFieldVersionInput } from '../../shared/types/fieldVersion';
import { transaction } from './schema';
import { SecurityService } from './securityService';

function rowToFieldVersion(row: Record<string, unknown>): CharacterFieldVersion {
  return {
    id: row.id as string,
    fieldId: row.fieldId as string,
    versionNumber: row.versionNumber as number,
    content: row.content as string,
    isActive: !!row.isActive,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
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
  constructor(private db: DatabaseSync, private security: SecurityService) {}

  /** Whether the character that owns this field is currently hidden -- the thing that decides
   * if a version's `content` needs encrypting/decrypting at all. */
  private isFieldHidden(fieldId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT c.is_hidden as isHidden FROM character_fields cf
         JOIN characters c ON c.id = cf.character_id
         WHERE cf.id = ?`
      )
      .get(fieldId) as { isHidden: number } | undefined;
    return !!row?.isHidden;
  }

  getVersionsByField(fieldId: string): CharacterFieldVersion[] {
    const isHidden = this.isFieldHidden(fieldId);
    const rows = this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM character_field_versions WHERE field_id = ? ORDER BY version_number`
      )
      .all(fieldId)
      .map(rowToFieldVersion)
      .map((v) => ({ ...v, content: this.security.decryptIfHidden(v.content, isHidden) }));
    return this.ensureLatestIsActive(fieldId, rows);
  }

  /** Self-heals rows written before active-always-tracks-latest was enforced at write time
   * (or any other drift) -- every read re-checks the invariant instead of trusting history.
   * Only touches `is_active`/`updated_at`, never `content`, so it's safe to run after content
   * has already been decrypted above. */
  private ensureLatestIsActive(
    fieldId: string,
    versions: CharacterFieldVersion[]
  ): CharacterFieldVersion[] {
    if (versions.length === 0) return versions;
    const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
    if (latest.isActive) return versions;

    const now = new Date().toISOString();
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE character_field_versions SET is_active = 0, updated_at = ? WHERE field_id = ? AND is_active = 1`
        )
        .run(now, fieldId);
      this.db
        .prepare(`UPDATE character_field_versions SET is_active = 1, updated_at = ? WHERE id = ?`)
        .run(now, latest.id);
    });

    return versions.map((v) => ({ ...v, isActive: v.id === latest.id }));
  }

  getVersionById(id: string): CharacterFieldVersion | null {
    const row = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM character_field_versions WHERE id = ?`)
      .get(id);
    if (!row) return null;
    const version = rowToFieldVersion(row);
    const isHidden = this.isFieldHidden(version.fieldId);
    return { ...version, content: this.security.decryptIfHidden(version.content, isHidden) };
  }

  /** Blank version; auto-activates only if it's the field's first version. */
  createVersion(input: CreateFieldVersionInput): CharacterFieldVersion {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      const existing = this.getVersionsByField(input.fieldId);
      const nextVersionNumber =
        existing.length === 0 ? 1 : Math.max(...existing.map((v) => v.versionNumber)) + 1;
      const isFirst = existing.length === 0;
      const isHidden = this.isFieldHidden(input.fieldId);
      const content = this.security.encryptIfHidden(input.content ?? '', isHidden);

      this.db
        .prepare(
          `INSERT INTO character_field_versions (id, field_id, version_number, content, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, input.fieldId, nextVersionNumber, content, isFirst ? 1 : 0, now, now);

      return this.getVersionById(id)!;
    });
  }

  /** "Save as new version" -- copies content into a new, always-active version. Active and
   * latest are the same concept in this app (only the latest is editable), so whatever you
   * just duplicated to becomes the one in effect immediately. Decrypts the source then
   * re-encrypts fresh rather than copying the raw ciphertext column, since every encryption
   * uses its own random IV. */
  duplicateVersion(versionId: string): CharacterFieldVersion {
    const source = this.getVersionById(versionId);
    if (!source) {
      throw new Error(`CharacterFieldVersion with id ${versionId} not found`);
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const isHidden = this.isFieldHidden(source.fieldId);

    return transaction(this.db, () => {
      const existing = this.getVersionsByField(source.fieldId);
      const nextVersionNumber = Math.max(...existing.map((v) => v.versionNumber)) + 1;

      // Deactivate the current active row first -- the partial unique index on is_active=1
      // would reject inserting a second active row otherwise.
      this.db
        .prepare(
          `UPDATE character_field_versions SET is_active = 0, updated_at = ? WHERE field_id = ? AND is_active = 1`
        )
        .run(now, source.fieldId);
      this.db
        .prepare(
          `INSERT INTO character_field_versions (id, field_id, version_number, content, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, source.fieldId, nextVersionNumber, this.security.encryptIfHidden(source.content, isHidden), now, now);

      return this.getVersionById(id)!;
    });
  }

  updateVersionContent(id: string, content: string): CharacterFieldVersion {
    const existing = this.getVersionById(id);
    if (!existing) {
      throw new Error(`CharacterFieldVersion with id ${id} not found`);
    }

    const isHidden = this.isFieldHidden(existing.fieldId);
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE character_field_versions SET content = ?, updated_at = ? WHERE id = ?`)
      .run(this.security.encryptIfHidden(content, isHidden), now, id);

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

    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM character_field_versions WHERE id = ?`).run(id);

      if (existing.isActive) {
        const remaining = siblings.filter((v) => v.id !== id);
        const mostRecent = remaining.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
        const now = new Date().toISOString();
        this.db
          .prepare(`UPDATE character_field_versions SET is_active = 1, updated_at = ? WHERE id = ?`)
          .run(now, mostRecent.id);
      }
    });
  }

  // --- Hide/unhide cascade, PIN-change rekeying, legacy migration -----------------------

  /** Encrypts (hidden=true) or decrypts (hidden=false) every version of every field belonging
   * to one character, in place. Called by CharacterService.setHidden inside its own
   * transaction. Requires the key to already be unlocked -- SecurityService throws otherwise. */
  setHiddenForCharacter(characterId: string, hidden: boolean): void {
    const rows = this.db
      .prepare(
        `SELECT cfv.id, cfv.content FROM character_field_versions cfv
         JOIN character_fields cf ON cf.id = cfv.field_id
         WHERE cf.character_id = ?`
      )
      .all(characterId) as { id: string; content: string }[];

    const stmt = this.db.prepare(`UPDATE character_field_versions SET content = ? WHERE id = ?`);
    for (const row of rows) {
      const next = hidden
        ? this.security.encrypt(row.content)
        : this.security.isEncrypted(row.content)
          ? this.security.decrypt(row.content)
          : row.content;
      stmt.run(next, row.id);
    }
  }

  /** PIN-change rekey: every version of every field belonging to a currently-hidden character. */
  reencryptHiddenContent(oldKey: Buffer, newKey: Buffer): void {
    const rows = this.db
      .prepare(
        `SELECT cfv.id, cfv.content FROM character_field_versions cfv
         JOIN character_fields cf ON cf.id = cfv.field_id
         JOIN characters c ON c.id = cf.character_id
         WHERE c.is_hidden = 1`
      )
      .all() as { id: string; content: string }[];

    const stmt = this.db.prepare(`UPDATE character_field_versions SET content = ? WHERE id = ?`);
    for (const row of rows) {
      stmt.run(this.security.reencryptWithKeys(row.content, oldKey, newKey), row.id);
    }
  }

  /** After a successful unlock, upgrades any hidden field-version content still sitting in
   * legacy plaintext (from before encryption existed) to real ciphertext. Idempotent -- a
   * no-op once everything's migrated, cheap even then since each row is just a prefix check. */
  migrateLegacyHiddenContent(): void {
    const rows = this.db
      .prepare(
        `SELECT cfv.id, cfv.content FROM character_field_versions cfv
         JOIN character_fields cf ON cf.id = cfv.field_id
         JOIN characters c ON c.id = cf.character_id
         WHERE c.is_hidden = 1`
      )
      .all() as { id: string; content: string }[];

    const stmt = this.db.prepare(`UPDATE character_field_versions SET content = ? WHERE id = ?`);
    for (const row of rows) {
      const migrated = this.security.migrateLegacyContent(row.content, true);
      if (migrated !== row.content) stmt.run(migrated, row.id);
    }
  }
}
