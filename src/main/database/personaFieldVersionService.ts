import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { PersonaBackgroundVersion } from '../../shared/types/userPersona';
import { transaction } from './schema';
import { SecurityService } from './securityService';

function rowToVersion(row: Record<string, unknown>): PersonaBackgroundVersion {
  return {
    id: row.id as string,
    personaId: row.personaId as string,
    versionNumber: row.versionNumber as number,
    content: row.content as string,
    isActive: !!row.isActive,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

const SELECT_COLUMNS = `
  id,
  persona_id as personaId,
  version_number as versionNumber,
  content,
  is_active as isActive,
  created_at as createdAt,
  updated_at as updatedAt
`;

/**
 * Version history for a persona's `background` field, mirroring FieldVersionService's shape
 * exactly -- same self-healing active-version invariant, same duplicate/update/delete
 * semantics, same hide/unhide + PIN-rekey + legacy-migration cascade -- except keyed directly
 * by `persona_id` rather than through a `character_fields`-style indirection table, since a
 * persona has exactly one versionable field rather than several field *types* per owner.
 */
export class PersonaFieldVersionService {
  constructor(private db: DatabaseSync, private security: SecurityService) {}

  private isPersonaHidden(personaId: string): boolean {
    const row = this.db.prepare(`SELECT is_hidden as isHidden FROM user_personas WHERE id = ?`).get(personaId) as
      | { isHidden: number }
      | undefined;
    return !!row?.isHidden;
  }

  getVersionsByPersona(personaId: string): PersonaBackgroundVersion[] {
    const isHidden = this.isPersonaHidden(personaId);
    const rows = this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM persona_background_versions WHERE persona_id = ? ORDER BY version_number`
      )
      .all(personaId)
      .map(rowToVersion)
      .map((v) => ({ ...v, content: this.security.decryptIfHidden(v.content, isHidden) }));
    return this.ensureLatestIsActive(personaId, rows);
  }

  /** Self-heals rows written before active-always-tracks-latest was enforced at write time (or
   * any other drift) -- every read re-checks the invariant instead of trusting history. Only
   * touches `is_active`/`updated_at`, never `content`, so it's safe to run after content has
   * already been decrypted above. */
  private ensureLatestIsActive(
    personaId: string,
    versions: PersonaBackgroundVersion[]
  ): PersonaBackgroundVersion[] {
    if (versions.length === 0) return versions;
    const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
    if (latest.isActive) return versions;

    const now = new Date().toISOString();
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE persona_background_versions SET is_active = 0, updated_at = ? WHERE persona_id = ? AND is_active = 1`
        )
        .run(now, personaId);
      this.db
        .prepare(`UPDATE persona_background_versions SET is_active = 1, updated_at = ? WHERE id = ?`)
        .run(now, latest.id);
    });

    return versions.map((v) => ({ ...v, isActive: v.id === latest.id }));
  }

  getVersionById(id: string): PersonaBackgroundVersion | null {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM persona_background_versions WHERE id = ?`).get(id);
    if (!row) return null;
    const version = rowToVersion(row);
    const isHidden = this.isPersonaHidden(version.personaId);
    return { ...version, content: this.security.decryptIfHidden(version.content, isHidden) };
  }

  /** Seeds a persona's first version -- called from ConversationService.createPersona, auto-active. */
  createVersion(personaId: string, content: string): PersonaBackgroundVersion {
    const id = uuidv4();
    const now = new Date().toISOString();
    const isHidden = this.isPersonaHidden(personaId);

    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO persona_background_versions (id, persona_id, version_number, content, is_active, created_at, updated_at)
           VALUES (?, ?, 1, ?, 1, ?, ?)`
        )
        .run(id, personaId, this.security.encryptIfHidden(content, isHidden), now, now);

      return this.getVersionById(id)!;
    });
  }

  /** "Save as new version" -- copies content into a new, always-active version. Active and
   * latest are the same concept in this app (only the latest is editable), so whatever you
   * just duplicated to becomes the one in effect immediately. Decrypts the source then
   * re-encrypts fresh rather than copying the raw ciphertext column, since every encryption
   * uses its own random IV. */
  duplicateVersion(versionId: string): PersonaBackgroundVersion {
    const source = this.getVersionById(versionId);
    if (!source) {
      throw new Error(`PersonaBackgroundVersion with id ${versionId} not found`);
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const isHidden = this.isPersonaHidden(source.personaId);

    return transaction(this.db, () => {
      const existing = this.getVersionsByPersona(source.personaId);
      const nextVersionNumber = Math.max(...existing.map((v) => v.versionNumber)) + 1;

      this.db
        .prepare(
          `UPDATE persona_background_versions SET is_active = 0, updated_at = ? WHERE persona_id = ? AND is_active = 1`
        )
        .run(now, source.personaId);
      this.db
        .prepare(
          `INSERT INTO persona_background_versions (id, persona_id, version_number, content, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, source.personaId, nextVersionNumber, this.security.encryptIfHidden(source.content, isHidden), now, now);

      return this.getVersionById(id)!;
    });
  }

  updateVersionContent(id: string, content: string): PersonaBackgroundVersion {
    const existing = this.getVersionById(id);
    if (!existing) {
      throw new Error(`PersonaBackgroundVersion with id ${id} not found`);
    }

    const isHidden = this.isPersonaHidden(existing.personaId);
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE persona_background_versions SET content = ?, updated_at = ? WHERE id = ?`)
      .run(this.security.encryptIfHidden(content, isHidden), now, id);

    return this.getVersionById(id)!;
  }

  /** Blocked if it's the persona's only version. If it was active, promotes the most recent remaining version. */
  deleteVersion(id: string): void {
    const existing = this.getVersionById(id);
    if (!existing) return;

    const siblings = this.getVersionsByPersona(existing.personaId);
    if (siblings.length <= 1) {
      throw new Error("Cannot delete a persona's only background version");
    }

    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM persona_background_versions WHERE id = ?`).run(id);

      if (existing.isActive) {
        const remaining = siblings.filter((v) => v.id !== id);
        const mostRecent = remaining.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
        const now = new Date().toISOString();
        this.db
          .prepare(`UPDATE persona_background_versions SET is_active = 1, updated_at = ? WHERE id = ?`)
          .run(now, mostRecent.id);
      }
    });
  }

  // --- Hide/unhide cascade, PIN-change rekeying, legacy migration -----------------------

  /** Encrypts (hidden=true) or decrypts (hidden=false) every version of one persona's
   * background, in place. Called by ConversationService.setPersonaHidden inside its own
   * transaction. Requires the key to already be unlocked -- SecurityService throws otherwise. */
  setHiddenForPersona(personaId: string, hidden: boolean): void {
    const rows = this.db
      .prepare(`SELECT id, content FROM persona_background_versions WHERE persona_id = ?`)
      .all(personaId) as { id: string; content: string }[];

    const stmt = this.db.prepare(`UPDATE persona_background_versions SET content = ? WHERE id = ?`);
    for (const row of rows) {
      const next = hidden
        ? this.security.encrypt(row.content)
        : this.security.isEncrypted(row.content)
          ? this.security.decrypt(row.content)
          : row.content;
      stmt.run(next, row.id);
    }
  }

  /** PIN-change rekey: every version of every currently-hidden persona's background. */
  reencryptHiddenContent(oldKey: Buffer, newKey: Buffer): void {
    const rows = this.db
      .prepare(
        `SELECT pbv.id, pbv.content FROM persona_background_versions pbv
         JOIN user_personas up ON up.id = pbv.persona_id
         WHERE up.is_hidden = 1`
      )
      .all() as { id: string; content: string }[];

    const stmt = this.db.prepare(`UPDATE persona_background_versions SET content = ? WHERE id = ?`);
    for (const row of rows) {
      stmt.run(this.security.reencryptWithKeys(row.content, oldKey, newKey), row.id);
    }
  }

  /** After a successful unlock, upgrades any hidden persona's background versions still
   * sitting in legacy plaintext (from before encryption existed) to real ciphertext.
   * Idempotent -- a no-op once everything's migrated. */
  migrateLegacyHiddenContent(): void {
    const rows = this.db
      .prepare(
        `SELECT pbv.id, pbv.content FROM persona_background_versions pbv
         JOIN user_personas up ON up.id = pbv.persona_id
         WHERE up.is_hidden = 1`
      )
      .all() as { id: string; content: string }[];

    const stmt = this.db.prepare(`UPDATE persona_background_versions SET content = ? WHERE id = ?`);
    for (const row of rows) {
      const migrated = this.security.migrateLegacyContent(row.content, true);
      if (migrated !== row.content) stmt.run(migrated, row.id);
    }
  }
}
