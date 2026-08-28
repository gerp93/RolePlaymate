import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import {
  Lorebook,
  LorebookEntry,
  LorebookEntryVersion,
  LorebookScope,
  CreateLorebookInput,
  UpdateLorebookInput,
  CreateLorebookEntryInput,
  UpdateLorebookEntryInput,
} from '../../shared/types/lorebook';
import { transaction } from './schema';
import { SecurityService } from './securityService';

const BOOK_COLUMNS = `
  id,
  name,
  description,
  scope,
  owner_character_id as ownerCharacterId,
  owner_persona_id as ownerPersonaId,
  image,
  is_hidden as isHidden,
  created_at as createdAt,
  updated_at as updatedAt
`;

/** Table-qualified variant for the join against character_lorebooks, which also has a
 * `created_at` -- the unqualified list is ambiguous there and SQLite rejects it. */
const BOOK_COLUMNS_QUALIFIED = `
  b.id,
  b.name,
  b.description,
  b.scope,
  b.owner_character_id as ownerCharacterId,
  b.owner_persona_id as ownerPersonaId,
  b.image,
  b.is_hidden as isHidden,
  b.created_at as createdAt,
  b.updated_at as updatedAt
`;

const ENTRY_COLUMNS = `
  id,
  lorebook_id as lorebookId,
  title,
  keys,
  enabled,
  always_on as alwaysOn,
  priority,
  created_at as createdAt,
  updated_at as updatedAt
`;

const VERSION_COLUMNS = `
  id,
  entry_id as entryId,
  version_number as versionNumber,
  content,
  is_active as isActive,
  created_at as createdAt,
  updated_at as updatedAt
`;

/** Pure column mapping, no decryption -- entries/versions don't carry their own hidden flag
 * (it belongs to the owning book), so callers resolve that separately and decrypt/encrypt
 * title/content explicitly. Mirrors fieldVersionService.ts's rowToFieldVersion. */
function rowToEntry(row: Record<string, unknown>): LorebookEntry {
  return {
    id: row.id as string,
    lorebookId: row.lorebookId as string,
    title: row.title as string,
    keys: row.keys as string,
    enabled: !!row.enabled,
    alwaysOn: !!row.alwaysOn,
    priority: row.priority as number,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

function rowToVersion(row: Record<string, unknown>): LorebookEntryVersion {
  return {
    id: row.id as string,
    entryId: row.entryId as string,
    versionNumber: row.versionNumber as number,
    content: row.content as string,
    isActive: !!row.isActive,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

/** An entry plus the text currently in effect, which is what the matcher actually needs. */
export interface EntryWithContent {
  entry: LorebookEntry;
  book: Lorebook;
  content: string;
}

export class LorebookService {
  constructor(private db: DatabaseSync, private security: SecurityService) {}

  /** Self-contained, like CharacterService.rowToCharacter -- a book carries its own
   * `is_hidden`, so name/description decrypt right here. */
  private rowToBook(row: Record<string, unknown>): Lorebook {
    const isHidden = !!row.isHidden;
    const description = row.description as string | null;
    return {
      id: row.id as string,
      name: this.security.decryptIfHidden(row.name as string, isHidden),
      description: description == null ? null : this.security.decryptIfHidden(description, isHidden),
      scope: row.scope as LorebookScope,
      ownerCharacterId: (row.ownerCharacterId as string | null) ?? null,
      ownerPersonaId: (row.ownerPersonaId as string | null) ?? null,
      image: (row.image as string | null) ?? null,
      isHidden,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  private isBookHidden(lorebookId: string): boolean {
    const row = this.db.prepare(`SELECT is_hidden as isHidden FROM lorebooks WHERE id = ?`).get(lorebookId) as
      | { isHidden: number }
      | undefined;
    return !!row?.isHidden;
  }

  private isBookHiddenForEntry(entryId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT b.is_hidden as isHidden FROM lorebook_entries e
         JOIN lorebooks b ON b.id = e.lorebook_id
         WHERE e.id = ?`
      )
      .get(entryId) as { isHidden: number } | undefined;
    return !!row?.isHidden;
  }

  // --- Books ---------------------------------------------------------------------------

  /** World books only -- personal books are reached through their owning character. */
  listWorldBooks(): Lorebook[] {
    return this.db
      .prepare(`SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE scope = 'world' ORDER BY name`)
      .all()
      .map((r) => this.rowToBook(r));
  }

  getBook(id: string): Lorebook | null {
    const row = this.db.prepare(`SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE id = ?`).get(id);
    return row ? this.rowToBook(row) : null;
  }

  /** New books are never created hidden, so nothing here ever needs to encrypt. */
  createBook(input: CreateLorebookInput): Lorebook {
    const scope = input.scope ?? 'world';
    if (scope === 'personal' && !input.ownerCharacterId && !input.ownerPersonaId) {
      throw new Error('A personal lorebook must name the character or persona it belongs to');
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO lorebooks (id, name, description, scope, owner_character_id, owner_persona_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        scope,
        scope === 'personal' ? (input.ownerCharacterId ?? null) : null,
        scope === 'personal' ? (input.ownerPersonaId ?? null) : null,
        now,
        now
      );
    return this.getBook(id)!;
  }

  updateBook(id: string, input: UpdateLorebookInput): Lorebook {
    const existing = this.getBook(id);
    if (!existing) throw new Error(`Lorebook with id ${id} not found`);

    const name = input.name ?? existing.name;
    const description = input.description ?? existing.description;
    this.db
      .prepare(`UPDATE lorebooks SET name = ?, description = ?, image = ?, updated_at = ? WHERE id = ?`)
      .run(
        this.security.encryptIfHidden(name, existing.isHidden),
        description == null ? null : this.security.encryptIfHidden(description, existing.isHidden),
        input.image !== undefined ? input.image : existing.image,
        new Date().toISOString(),
        id
      );
    return this.getBook(id)!;
  }

  /** Same shape as CharacterService.setHidden: encrypts (or, on unhide, just writes back the
   * already-decrypted plaintext) the book's own name/description, then cascades to every
   * entry's title and every version's content, all in one transaction. Requires unlock. */
  setHidden(id: string, hidden: boolean): Lorebook {
    const existing = this.getBook(id);
    if (!existing) throw new Error(`Lorebook with id ${id} not found`);
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
        .prepare(`UPDATE lorebooks SET name = ?, description = ?, is_hidden = ?, updated_at = ? WHERE id = ?`)
        .run(name, description, hidden ? 1 : 0, now, id);

      this.setHiddenForEntries(id, hidden);

      return this.getBook(id)!;
    });
  }

  /** Cascade for setHidden: every entry's title and every version's content for one book. */
  private setHiddenForEntries(lorebookId: string, hidden: boolean): void {
    const entryRows = this.db
      .prepare(`SELECT id, title FROM lorebook_entries WHERE lorebook_id = ?`)
      .all(lorebookId) as { id: string; title: string }[];

    const titleStmt = this.db.prepare(`UPDATE lorebook_entries SET title = ? WHERE id = ?`);
    for (const row of entryRows) {
      const next = hidden
        ? this.security.encrypt(row.title)
        : this.security.isEncrypted(row.title)
          ? this.security.decrypt(row.title)
          : row.title;
      titleStmt.run(next, row.id);
    }

    const versionRows = this.db
      .prepare(
        `SELECT v.id, v.content FROM lorebook_entry_versions v
         JOIN lorebook_entries e ON e.id = v.entry_id
         WHERE e.lorebook_id = ?`
      )
      .all(lorebookId) as { id: string; content: string }[];

    const contentStmt = this.db.prepare(`UPDATE lorebook_entry_versions SET content = ? WHERE id = ?`);
    for (const row of versionRows) {
      const next = hidden
        ? this.security.encrypt(row.content)
        : this.security.isEncrypted(row.content)
          ? this.security.decrypt(row.content)
          : row.content;
      contentStmt.run(next, row.id);
    }
  }

  /** PIN-change rekey for one book's own name/description plus every entry title and version
   * content in it -- called once per currently-hidden book by main.ts's rekey orchestration. */
  reencryptHiddenBook(bookId: string, oldKey: Buffer, newKey: Buffer): void {
    const row = this.db
      .prepare(`SELECT name, description FROM lorebooks WHERE id = ?`)
      .get(bookId) as { name: string; description: string | null };
    const name = this.security.reencryptWithKeys(row.name, oldKey, newKey);
    const description = row.description == null ? null : this.security.reencryptWithKeys(row.description, oldKey, newKey);
    this.db.prepare(`UPDATE lorebooks SET name = ?, description = ? WHERE id = ?`).run(name, description, bookId);

    const entryRows = this.db
      .prepare(`SELECT id, title FROM lorebook_entries WHERE lorebook_id = ?`)
      .all(bookId) as { id: string; title: string }[];
    const titleStmt = this.db.prepare(`UPDATE lorebook_entries SET title = ? WHERE id = ?`);
    for (const entryRow of entryRows) {
      titleStmt.run(this.security.reencryptWithKeys(entryRow.title, oldKey, newKey), entryRow.id);
    }

    const versionRows = this.db
      .prepare(
        `SELECT v.id, v.content FROM lorebook_entry_versions v
         JOIN lorebook_entries e ON e.id = v.entry_id
         WHERE e.lorebook_id = ?`
      )
      .all(bookId) as { id: string; content: string }[];
    const contentStmt = this.db.prepare(`UPDATE lorebook_entry_versions SET content = ? WHERE id = ?`);
    for (const versionRow of versionRows) {
      contentStmt.run(this.security.reencryptWithKeys(versionRow.content, oldKey, newKey), versionRow.id);
    }
  }

  /** Every currently-hidden book, rekeyed. Called from main.ts. */
  reencryptAllHiddenContent(oldKey: Buffer, newKey: Buffer): void {
    const hiddenBookIds = this.db.prepare(`SELECT id FROM lorebooks WHERE is_hidden = 1`).all() as { id: string }[];
    for (const { id } of hiddenBookIds) {
      this.reencryptHiddenBook(id, oldKey, newKey);
    }
  }

  /** After a successful unlock, upgrades any hidden book/entry/version still sitting in
   * legacy plaintext (from before encryption existed) to real ciphertext. */
  migrateLegacyHiddenContent(): void {
    const bookRows = this.db
      .prepare(`SELECT id, name, description FROM lorebooks WHERE is_hidden = 1`)
      .all() as { id: string; name: string; description: string | null }[];
    const bookStmt = this.db.prepare(`UPDATE lorebooks SET name = ?, description = ? WHERE id = ?`);
    for (const row of bookRows) {
      const name = this.security.migrateLegacyContent(row.name, true);
      const description = row.description == null ? null : this.security.migrateLegacyContent(row.description, true);
      if (name !== row.name || description !== row.description) {
        bookStmt.run(name, description, row.id);
      }
    }

    const entryRows = this.db
      .prepare(
        `SELECT e.id, e.title FROM lorebook_entries e
         JOIN lorebooks b ON b.id = e.lorebook_id
         WHERE b.is_hidden = 1`
      )
      .all() as { id: string; title: string }[];
    const entryStmt = this.db.prepare(`UPDATE lorebook_entries SET title = ? WHERE id = ?`);
    for (const row of entryRows) {
      const title = this.security.migrateLegacyContent(row.title, true);
      if (title !== row.title) entryStmt.run(title, row.id);
    }

    const versionRows = this.db
      .prepare(
        `SELECT v.id, v.content FROM lorebook_entry_versions v
         JOIN lorebook_entries e ON e.id = v.entry_id
         JOIN lorebooks b ON b.id = e.lorebook_id
         WHERE b.is_hidden = 1`
      )
      .all() as { id: string; content: string }[];
    const versionStmt = this.db.prepare(`UPDATE lorebook_entry_versions SET content = ? WHERE id = ?`);
    for (const row of versionRows) {
      const content = this.security.migrateLegacyContent(row.content, true);
      if (content !== row.content) versionStmt.run(content, row.id);
    }
  }

  /** Cascades to entries, versions and attachments through the schema's foreign keys. */
  deleteBook(id: string): void {
    this.db.prepare(`DELETE FROM lorebooks WHERE id = ?`).run(id);
  }

  /**
   * Clones a world book: its name (suffixed), description, image, and every entry's current
   * active content as a fresh single-version entry -- not the source entry's full edit
   * history, which clone doesn't try to preserve. Attachments are not copied: a clone starts
   * unattached from every character, same as a brand-new book would. A cloned book is never
   * itself hidden, so its content is written back as plain text regardless of the source's
   * hidden state -- `listEntries`/`getActiveContent` below already hand back decrypted text.
   */
  cloneBook(id: string, clonedImagePath: string | null): Lorebook {
    const source = this.getBook(id);
    if (!source) throw new Error(`Lorebook with id ${id} not found`);
    if (source.scope !== 'world') throw new Error('Only world books can be cloned');

    const sourceEntries = this.listEntries(id);

    return transaction(this.db, () => {
      const cloned = this.createBook({ name: `${source.name} (Copy)`, description: source.description ?? undefined });
      if (clonedImagePath) this.updateBook(cloned.id, { image: clonedImagePath });

      for (const entry of sourceEntries) {
        const newEntry = this.createEntry({
          lorebookId: cloned.id,
          title: entry.title,
          keys: entry.keys,
          content: this.getActiveContent(entry.id),
          alwaysOn: entry.alwaysOn,
          priority: entry.priority,
        });
        if (!entry.enabled) this.updateEntry(newEntry.id, { enabled: false });
      }

      return this.getBook(cloned.id)!;
    });
  }

  /**
   * A character's own private history book, created on first use.
   *
   * Lazily rather than alongside the character, so characters that never need one don't
   * accumulate empty books -- and so characters created before lorebooks existed get one
   * the moment it's asked for.
   */
  getOrCreatePersonalBook(characterId: string, characterName: string): Lorebook {
    const row = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE scope = 'personal' AND owner_character_id = ?`
      )
      .get(characterId);
    if (row) return this.rowToBook(row);

    return this.createBook({
      name: `${characterName}'s history`,
      scope: 'personal',
      ownerCharacterId: characterId,
    });
  }

  /** A persona's own private history book -- the persona equivalent of getOrCreatePersonalBook. */
  getOrCreatePersonalBookForPersona(personaId: string, personaName: string): Lorebook {
    const row = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE scope = 'personal' AND owner_persona_id = ?`
      )
      .get(personaId);
    if (row) return this.rowToBook(row);

    return this.createBook({
      name: `${personaName}'s history`,
      scope: 'personal',
      ownerPersonaId: personaId,
    });
  }

  // --- Attachment ----------------------------------------------------------------------

  /** World books attached to a character, plus its personal book when one exists. */
  getBooksForCharacter(characterId: string): { world: Lorebook[]; personal: Lorebook | null } {
    const world = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS_QUALIFIED} FROM lorebooks b
         JOIN character_lorebooks cl ON cl.lorebook_id = b.id
         WHERE cl.character_id = ? AND b.scope = 'world'
         ORDER BY b.name`
      )
      .all(characterId)
      .map((r) => this.rowToBook(r));

    const personalRow = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE scope = 'personal' AND owner_character_id = ?`
      )
      .get(characterId);

    return { world, personal: personalRow ? this.rowToBook(personalRow) : null };
  }

  attachBook(characterId: string, lorebookId: string): void {
    const book = this.getBook(lorebookId);
    if (!book) throw new Error(`Lorebook with id ${lorebookId} not found`);
    // A personal book belongs to exactly one character by construction; letting it be
    // attached elsewhere would leak one character's private history into another's prompt.
    if (book.scope === 'personal') {
      throw new Error('Personal lorebooks belong to their character and cannot be attached');
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO character_lorebooks (character_id, lorebook_id, created_at)
         VALUES (?, ?, ?)`
      )
      .run(characterId, lorebookId, new Date().toISOString());
  }

  detachBook(characterId: string, lorebookId: string): void {
    this.db
      .prepare(`DELETE FROM character_lorebooks WHERE character_id = ? AND lorebook_id = ?`)
      .run(characterId, lorebookId);
  }

  // --- Entries -------------------------------------------------------------------------

  listEntries(lorebookId: string): LorebookEntry[] {
    const isHidden = this.isBookHidden(lorebookId);
    return this.db
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM lorebook_entries WHERE lorebook_id = ? ORDER BY priority DESC, title`
      )
      .all(lorebookId)
      .map(rowToEntry)
      .map((e) => ({ ...e, title: this.security.decryptIfHidden(e.title, isHidden) }));
  }

  getEntry(id: string): LorebookEntry | null {
    const row = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM lorebook_entries WHERE id = ?`).get(id);
    if (!row) return null;
    const entry = rowToEntry(row);
    const isHidden = this.isBookHidden(entry.lorebookId);
    return { ...entry, title: this.security.decryptIfHidden(entry.title, isHidden) };
  }

  createEntry(input: CreateLorebookEntryInput): LorebookEntry {
    const id = uuidv4();
    const now = new Date().toISOString();
    const isHidden = this.isBookHidden(input.lorebookId);

    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO lorebook_entries (id, lorebook_id, title, keys, enabled, always_on, priority, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.lorebookId,
          this.security.encryptIfHidden(input.title, isHidden),
          input.keys ?? '',
          input.alwaysOn ? 1 : 0,
          input.priority ?? 0,
          now,
          now
        );

      // Every entry starts with a version, so there is never an entry with no text to show.
      this.createVersion(id, input.content ?? '');
      return this.getEntry(id)!;
    });
  }

  updateEntry(id: string, input: UpdateLorebookEntryInput): LorebookEntry {
    const existing = this.getEntry(id);
    if (!existing) throw new Error(`Lorebook entry with id ${id} not found`);
    const isHidden = this.isBookHidden(existing.lorebookId);
    const title = input.title ?? existing.title;

    this.db
      .prepare(
        `UPDATE lorebook_entries SET title = ?, keys = ?, enabled = ?, always_on = ?, priority = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        this.security.encryptIfHidden(title, isHidden),
        input.keys ?? existing.keys,
        (input.enabled ?? existing.enabled) ? 1 : 0,
        (input.alwaysOn ?? existing.alwaysOn) ? 1 : 0,
        input.priority ?? existing.priority,
        new Date().toISOString(),
        id
      );
    return this.getEntry(id)!;
  }

  deleteEntry(id: string): void {
    this.db.prepare(`DELETE FROM lorebook_entries WHERE id = ?`).run(id);
  }

  // --- Entry versions ------------------------------------------------------------------
  // Deliberately the same model as CharacterFieldVersion: active always tracks the latest,
  // self-healed on read, and "save as new version" duplicates rather than overwriting.

  /**
   * NOTE: active always tracks the latest version, exactly as character fields behave --
   * there is deliberately no "activate an older version" operation. An earlier draft had
   * one, and it fought this self-healing read: the lore scan (which reads is_active
   * directly) respected the manual switch while the editor silently undid it. One rule,
   * one behaviour: to make older text live again, save it as a new version.
   */
  getVersions(entryId: string): LorebookEntryVersion[] {
    const isHidden = this.isBookHiddenForEntry(entryId);
    const versions = this.db
      .prepare(
        `SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE entry_id = ? ORDER BY version_number`
      )
      .all(entryId)
      .map(rowToVersion)
      .map((v) => ({ ...v, content: this.security.decryptIfHidden(v.content, isHidden) }));
    return this.ensureLatestIsActive(entryId, versions);
  }

  /** Same self-healing read as fieldVersionService: re-check the invariant rather than
   * trusting that every past write maintained it. Only touches is_active/updated_at, never
   * content, so it's safe to run after content has already been decrypted above. */
  private ensureLatestIsActive(
    entryId: string,
    versions: LorebookEntryVersion[]
  ): LorebookEntryVersion[] {
    if (versions.length === 0) return versions;
    const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
    if (latest.isActive) return versions;

    const now = new Date().toISOString();
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE lorebook_entry_versions SET is_active = 0, updated_at = ? WHERE entry_id = ? AND is_active = 1`
        )
        .run(now, entryId);
      this.db
        .prepare(`UPDATE lorebook_entry_versions SET is_active = 1, updated_at = ? WHERE id = ?`)
        .run(now, latest.id);
    });

    return versions.map((v) => ({ ...v, isActive: v.id === latest.id }));
  }

  getActiveContent(entryId: string): string {
    return this.getVersions(entryId).find((v) => v.isActive)?.content ?? '';
  }

  createVersion(entryId: string, content: string): LorebookEntryVersion {
    const id = uuidv4();
    const now = new Date().toISOString();
    const isHidden = this.isBookHiddenForEntry(entryId);

    return transaction(this.db, () => {
      const existing = this.db
        .prepare(
          `SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE entry_id = ? ORDER BY version_number`
        )
        .all(entryId)
        .map(rowToVersion);

      const nextVersionNumber =
        existing.length === 0 ? 1 : Math.max(...existing.map((v) => v.versionNumber)) + 1;

      // Deactivate first: the partial unique index rejects a second active row.
      this.db
        .prepare(
          `UPDATE lorebook_entry_versions SET is_active = 0, updated_at = ? WHERE entry_id = ? AND is_active = 1`
        )
        .run(now, entryId);
      this.db
        .prepare(
          `INSERT INTO lorebook_entry_versions (id, entry_id, version_number, content, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, entryId, nextVersionNumber, this.security.encryptIfHidden(content, isHidden), now, now);

      const row = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`).get(id)!;
      const version = rowToVersion(row);
      return { ...version, content: this.security.decryptIfHidden(version.content, isHidden) };
    });
  }

  updateVersionContent(versionId: string, content: string): LorebookEntryVersion {
    const existingRow = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`)
      .get(versionId);
    if (!existingRow) throw new Error(`Lorebook entry version with id ${versionId} not found`);
    const entryId = rowToVersion(existingRow).entryId;
    const isHidden = this.isBookHiddenForEntry(entryId);

    this.db
      .prepare(`UPDATE lorebook_entry_versions SET content = ?, updated_at = ? WHERE id = ?`)
      .run(this.security.encryptIfHidden(content, isHidden), new Date().toISOString(), versionId);

    const row = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`).get(versionId)!;
    const version = rowToVersion(row);
    return { ...version, content: this.security.decryptIfHidden(version.content, isHidden) };
  }

  /** Blocked on the last remaining version, as with character fields -- an entry with no
   * versions has no text at all, which the rest of the code doesn't expect. */
  deleteVersion(versionId: string): void {
    const row = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`)
      .get(versionId);
    if (!row) return;
    const version = rowToVersion(row); // content unused below -- no need to decrypt here

    const siblings = this.getVersions(version.entryId);
    if (siblings.length <= 1) {
      throw new Error("Cannot delete an entry's only version");
    }

    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM lorebook_entry_versions WHERE id = ?`).run(versionId);
      if (version.isActive) {
        const remaining = siblings.filter((v) => v.id !== versionId);
        const mostRecent = remaining.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
        this.db
          .prepare(`UPDATE lorebook_entry_versions SET is_active = 1, updated_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), mostRecent.id);
      }
    });
  }

  // --- Everything in scope for one character, ready for the matcher --------------------

  /**
   * Enabled entries from the character's attached world books and its own personal book,
   * each with the text currently in effect.
   *
   * One query per entry for content would be N+1 on every turn, so the active version is
   * joined in directly -- which means this bypasses rowToEntry/rowToVersion's normal callers
   * entirely, so title/content are decrypted right here using the joined book's own
   * `is_hidden` rather than through listEntries/getVersions.
   */
  getEntriesForCharacter(characterId: string): EntryWithContent[] {
    const rows = this.db
      .prepare(
        `SELECT
           e.id, e.lorebook_id as lorebookId, e.title, e.keys, e.enabled,
           e.always_on as alwaysOn, e.priority,
           e.created_at as createdAt, e.updated_at as updatedAt,
           v.content as activeContent,
           b.id as bookId, b.name as bookName, b.description as bookDescription,
           b.scope as bookScope, b.owner_character_id as bookOwnerCharacterId,
           b.is_hidden as bookIsHidden,
           b.created_at as bookCreatedAt, b.updated_at as bookUpdatedAt
         FROM lorebook_entries e
         JOIN lorebooks b ON b.id = e.lorebook_id
         LEFT JOIN lorebook_entry_versions v ON v.entry_id = e.id AND v.is_active = 1
         WHERE e.enabled = 1
           AND (
             b.id IN (SELECT lorebook_id FROM character_lorebooks WHERE character_id = ?)
             OR (b.scope = 'personal' AND b.owner_character_id = ?)
           )
         ORDER BY e.priority DESC, e.title`
      )
      .all(characterId, characterId);

    return rows.map((row) => {
      const isHidden = !!row.bookIsHidden;
      const entry = rowToEntry(row);
      return {
        entry: { ...entry, title: this.security.decryptIfHidden(entry.title, isHidden) },
        book: this.rowToBook({
          id: row.bookId,
          name: row.bookName,
          description: row.bookDescription,
          scope: row.bookScope,
          ownerCharacterId: row.bookOwnerCharacterId,
          isHidden: row.bookIsHidden,
          createdAt: row.bookCreatedAt,
          updatedAt: row.bookUpdatedAt,
        }),
        content: this.security.decryptIfHidden((row.activeContent as string | null) ?? '', isHidden),
      };
    });
  }

  /**
   * Enabled entries from the persona's own personal book, each with the text currently in
   * effect. Unlike getEntriesForCharacter there is no world-book join -- personas don't
   * attach to shared world books, only characters do, so a persona's only lore is its own
   * personal history.
   */
  getEntriesForPersona(personaId: string): EntryWithContent[] {
    const rows = this.db
      .prepare(
        `SELECT
           e.id, e.lorebook_id as lorebookId, e.title, e.keys, e.enabled,
           e.always_on as alwaysOn, e.priority,
           e.created_at as createdAt, e.updated_at as updatedAt,
           v.content as activeContent,
           b.id as bookId, b.name as bookName, b.description as bookDescription,
           b.scope as bookScope, b.owner_persona_id as bookOwnerPersonaId,
           b.is_hidden as bookIsHidden,
           b.created_at as bookCreatedAt, b.updated_at as bookUpdatedAt
         FROM lorebook_entries e
         JOIN lorebooks b ON b.id = e.lorebook_id
         LEFT JOIN lorebook_entry_versions v ON v.entry_id = e.id AND v.is_active = 1
         WHERE e.enabled = 1 AND b.scope = 'personal' AND b.owner_persona_id = ?
         ORDER BY e.priority DESC, e.title`
      )
      .all(personaId);

    return rows.map((row) => {
      const isHidden = !!row.bookIsHidden;
      const entry = rowToEntry(row);
      return {
        entry: { ...entry, title: this.security.decryptIfHidden(entry.title, isHidden) },
        book: this.rowToBook({
          id: row.bookId,
          name: row.bookName,
          description: row.bookDescription,
          scope: row.bookScope,
          ownerPersonaId: row.bookOwnerPersonaId,
          isHidden: row.bookIsHidden,
          createdAt: row.bookCreatedAt,
          updatedAt: row.bookUpdatedAt,
        }),
        content: this.security.decryptIfHidden((row.activeContent as string | null) ?? '', isHidden),
      };
    });
  }
}
