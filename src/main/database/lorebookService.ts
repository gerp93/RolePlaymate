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

const BOOK_COLUMNS = `
  id,
  name,
  description,
  scope,
  owner_character_id as ownerCharacterId,
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

function rowToBook(row: Record<string, unknown>): Lorebook {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    scope: row.scope as LorebookScope,
    ownerCharacterId: (row.ownerCharacterId as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

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
  constructor(private db: DatabaseSync) {}

  // --- Books ---------------------------------------------------------------------------

  /** World books only -- personal books are reached through their owning character. */
  listWorldBooks(): Lorebook[] {
    return this.db
      .prepare(`SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE scope = 'world' ORDER BY name`)
      .all()
      .map(rowToBook);
  }

  getBook(id: string): Lorebook | null {
    const row = this.db.prepare(`SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE id = ?`).get(id);
    return row ? rowToBook(row) : null;
  }

  createBook(input: CreateLorebookInput): Lorebook {
    const scope = input.scope ?? 'world';
    if (scope === 'personal' && !input.ownerCharacterId) {
      throw new Error('A personal lorebook must name the character it belongs to');
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO lorebooks (id, name, description, scope, owner_character_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        scope,
        scope === 'personal' ? input.ownerCharacterId! : null,
        now,
        now
      );
    return this.getBook(id)!;
  }

  updateBook(id: string, input: UpdateLorebookInput): Lorebook {
    const existing = this.getBook(id);
    if (!existing) throw new Error(`Lorebook with id ${id} not found`);

    this.db
      .prepare(`UPDATE lorebooks SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
      .run(
        input.name ?? existing.name,
        input.description ?? existing.description,
        new Date().toISOString(),
        id
      );
    return this.getBook(id)!;
  }

  /** Cascades to entries, versions and attachments through the schema's foreign keys. */
  deleteBook(id: string): void {
    this.db.prepare(`DELETE FROM lorebooks WHERE id = ?`).run(id);
  }

  /**
   * The character's own private history book, created on first use.
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
    if (row) return rowToBook(row);

    return this.createBook({
      name: `${characterName}'s history`,
      scope: 'personal',
      ownerCharacterId: characterId,
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
      .map(rowToBook);

    const personalRow = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE scope = 'personal' AND owner_character_id = ?`
      )
      .get(characterId);

    return { world, personal: personalRow ? rowToBook(personalRow) : null };
  }

  /** Characters a world book is attached to -- shown on the book so its reach is visible. */
  getCharacterIdsForBook(lorebookId: string): string[] {
    return this.db
      .prepare(`SELECT character_id as characterId FROM character_lorebooks WHERE lorebook_id = ?`)
      .all(lorebookId)
      .map((row) => row.characterId as string);
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
    return this.db
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM lorebook_entries WHERE lorebook_id = ? ORDER BY priority DESC, title`
      )
      .all(lorebookId)
      .map(rowToEntry);
  }

  getEntry(id: string): LorebookEntry | null {
    const row = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM lorebook_entries WHERE id = ?`).get(id);
    return row ? rowToEntry(row) : null;
  }

  createEntry(input: CreateLorebookEntryInput): LorebookEntry {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO lorebook_entries (id, lorebook_id, title, keys, enabled, always_on, priority, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.lorebookId,
          input.title,
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

    this.db
      .prepare(
        `UPDATE lorebook_entries SET title = ?, keys = ?, enabled = ?, always_on = ?, priority = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.title ?? existing.title,
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
    const versions = this.db
      .prepare(
        `SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE entry_id = ? ORDER BY version_number`
      )
      .all(entryId)
      .map(rowToVersion);
    return this.ensureLatestIsActive(entryId, versions);
  }

  /** Same self-healing read as fieldVersionService: re-check the invariant rather than
   * trusting that every past write maintained it. */
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
        .run(id, entryId, nextVersionNumber, content, now, now);

      return this.db
        .prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`)
        .get(id) as unknown as LorebookEntryVersion;
    });
  }

  updateVersionContent(versionId: string, content: string): LorebookEntryVersion {
    this.db
      .prepare(`UPDATE lorebook_entry_versions SET content = ?, updated_at = ? WHERE id = ?`)
      .run(content, new Date().toISOString(), versionId);
    const row = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`)
      .get(versionId);
    if (!row) throw new Error(`Lorebook entry version with id ${versionId} not found`);
    return rowToVersion(row);
  }

  /** Blocked on the last remaining version, as with character fields -- an entry with no
   * versions has no text at all, which the rest of the code doesn't expect. */
  deleteVersion(versionId: string): void {
    const row = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`)
      .get(versionId);
    if (!row) return;
    const version = rowToVersion(row);

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
   * joined in directly.
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

    return rows.map((row) => ({
      entry: rowToEntry(row),
      book: rowToBook({
        id: row.bookId,
        name: row.bookName,
        description: row.bookDescription,
        scope: row.bookScope,
        ownerCharacterId: row.bookOwnerCharacterId,
        createdAt: row.bookCreatedAt,
        updatedAt: row.bookUpdatedAt,
      }),
      content: (row.activeContent as string | null) ?? '',
    }));
  }
}
