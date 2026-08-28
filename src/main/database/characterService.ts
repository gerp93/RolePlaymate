import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { Character, CreateCharacterInput, UpdateCharacterInput } from '../../shared/types/character';
import { transaction } from './schema';
import { SecurityService } from './securityService';
import { FieldVersionService } from './fieldVersionService';

export class CharacterService {
  constructor(
    private db: DatabaseSync,
    private security: SecurityService,
    private fieldVersions: FieldVersionService
  ) {}

  /** Rows come back keyed by the SELECT_COLUMNS aliases, so this only has to fix up what SQL
   * can't express -- NULL vs undefined for the optional description, and decrypting name/
   * description when the character is hidden. */
  private rowToCharacter(row: Record<string, unknown>): Character {
    const isHidden = !!row.isHidden;
    const description = row.description as string | null;
    return {
      id: row.id as string,
      name: this.security.decryptIfHidden(row.name as string, isHidden),
      description: description == null ? null : this.security.decryptIfHidden(description, isHidden),
      isHidden,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  private readonly SELECT_COLUMNS = `
    id,
    name,
    description,
    is_hidden as isHidden,
    created_at as createdAt,
    updated_at as updatedAt
  `;

  getAllCharacters(): Character[] {
    const rows = this.db
      .prepare(`SELECT ${this.SELECT_COLUMNS} FROM characters ORDER BY updated_at DESC`)
      .all();
    return rows.map((r) => this.rowToCharacter(r));
  }

  getCharacterById(id: string): Character | null {
    const row = this.db.prepare(`SELECT ${this.SELECT_COLUMNS} FROM characters WHERE id = ?`).get(id);
    return row ? this.rowToCharacter(row) : null;
  }

  /** New characters are never created hidden, so nothing here ever needs to encrypt. */
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

    const name = input.name ?? existing.name;
    const description = input.description ?? existing.description;
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE characters SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
      .run(
        this.security.encryptIfHidden(name, existing.isHidden),
        description == null ? null : this.security.encryptIfHidden(description, existing.isHidden),
        now,
        id
      );

    return this.getCharacterById(id)!;
  }

  /**
   * The hide/unhide pivot: `existing` (fetched before the flag changes) already carries
   * decrypted plaintext when currently hidden -- `getCharacterById` decrypts via
   * `rowToCharacter` as long as the session is unlocked, which is required below regardless of
   * direction. On hide, that plaintext gets encrypted and written under the new flag; on
   * unhide, it's already plaintext and just needs the flag flipped. Cascades to every field
   * version's content in the same transaction, so a character's fields are never left
   * encrypted while its name/description aren't, or vice versa.
   */
  setHidden(id: string, hidden: boolean): Character {
    const existing = this.getCharacterById(id);
    if (!existing) {
      throw new Error(`Character with id ${id} not found`);
    }
    if (!this.security.isUnlocked()) {
      throw new Error('Unlock with the PIN before hiding or unhiding an item');
    }

    return transaction(this.db, () => {
      const now = new Date().toISOString();
      const name = hidden ? this.security.encrypt(existing.name) : existing.name;
      const description =
        existing.description == null
          ? null
          : hidden
            ? this.security.encrypt(existing.description)
            : existing.description;

      this.db
        .prepare(`UPDATE characters SET name = ?, description = ?, is_hidden = ?, updated_at = ? WHERE id = ?`)
        .run(name, description, hidden ? 1 : 0, now, id);

      this.fieldVersions.setHiddenForCharacter(id, hidden);

      return this.getCharacterById(id)!;
    });
  }

  /** PIN-change rekey for this character's name/description. Field-version content is
   * rekeyed separately by FieldVersionService.reencryptHiddenContent. */
  reencryptHiddenContent(oldKey: Buffer, newKey: Buffer): void {
    const rows = this.db
      .prepare(`SELECT id, name, description FROM characters WHERE is_hidden = 1`)
      .all() as { id: string; name: string; description: string | null }[];

    const stmt = this.db.prepare(`UPDATE characters SET name = ?, description = ? WHERE id = ?`);
    for (const row of rows) {
      const name = this.security.reencryptWithKeys(row.name, oldKey, newKey);
      const description =
        row.description == null ? null : this.security.reencryptWithKeys(row.description, oldKey, newKey);
      stmt.run(name, description, row.id);
    }
  }

  /** After a successful unlock, upgrades any hidden character still sitting in legacy
   * plaintext (from before encryption existed) to real ciphertext. */
  migrateLegacyHiddenContent(): void {
    const rows = this.db
      .prepare(`SELECT id, name, description FROM characters WHERE is_hidden = 1`)
      .all() as { id: string; name: string; description: string | null }[];

    const stmt = this.db.prepare(`UPDATE characters SET name = ?, description = ? WHERE id = ?`);
    for (const row of rows) {
      const name = this.security.migrateLegacyContent(row.name, true);
      const description = row.description == null ? null : this.security.migrateLegacyContent(row.description, true);
      if (name !== row.name || description !== row.description) {
        stmt.run(name, description, row.id);
      }
    }
  }

  /** Cascades to character_fields, character_field_versions, and character_images via the
   * schema's ON DELETE CASCADE constraints, which are enforced now that foreign keys are on.
   * Note this removes the image *rows* but not the files on disk -- callers that care fetch
   * the paths before deleting and unlink them (see the characters:delete IPC handler). */
  deleteCharacter(id: string): void {
    this.db.prepare(`DELETE FROM characters WHERE id = ?`).run(id);
  }
}
