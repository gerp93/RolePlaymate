import type { DatabaseSync } from './sqlite';
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
  hit_count as hitCount,
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
    hitCount: Number(row.hitCount ?? 0),
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

  private rowToBook(row: Record<string, unknown>): Lorebook {
    const description = row.description as string | null;
    return {
      id: row.id as string,
      name: row.name as string,
      description,
      scope: row.scope as LorebookScope,
      ownerCharacterId: (row.ownerCharacterId as string | null) ?? null,
      ownerPersonaId: (row.ownerPersonaId as string | null) ?? null,
      image: (row.image as string | null) ?? null,
      isHidden: !!row.isHidden,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
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
        name,
        description,
        input.image !== undefined ? input.image : existing.image,
        new Date().toISOString(),
        id
      );
    return this.getBook(id)!;
  }

  /** Same as CharacterService.setHidden: a privacy-screen flag flip that still requires the PIN
   * to have been entered. Entries and versions are untouched -- hiding never rewrites content. */
  setHidden(id: string, hidden: boolean): Lorebook {
    const existing = this.getBook(id);
    if (!existing) throw new Error(`Lorebook with id ${id} not found`);
    if (!this.security.isUnlocked()) {
      throw new Error('Unlock with the PIN before hiding or unhiding an item');
    }

    this.db
      .prepare(`UPDATE lorebooks SET is_hidden = ?, updated_at = ? WHERE id = ?`)
      .run(hidden ? 1 : 0, new Date().toISOString(), id);
    return this.getBook(id)!;
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

  /** World books attached to a persona, plus its personal book when one exists -- the persona
   * equivalent of getBooksForCharacter. */
  getBooksForPersona(personaId: string): { world: Lorebook[]; personal: Lorebook | null } {
    const world = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS_QUALIFIED} FROM lorebooks b
         JOIN persona_lorebooks pl ON pl.lorebook_id = b.id
         WHERE pl.persona_id = ? AND b.scope = 'world'
         ORDER BY b.name`
      )
      .all(personaId)
      .map((r) => this.rowToBook(r));

    const personalRow = this.db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM lorebooks WHERE scope = 'personal' AND owner_persona_id = ?`
      )
      .get(personaId);

    return { world, personal: personalRow ? this.rowToBook(personalRow) : null };
  }

  /** The persona equivalent of attachBook -- only reaches "Suggest reply", not a character's
   * normal reply (see persona_lorebooks' schema comment). */
  attachBookForPersona(personaId: string, lorebookId: string): void {
    const book = this.getBook(lorebookId);
    if (!book) throw new Error(`Lorebook with id ${lorebookId} not found`);
    if (book.scope === 'personal') {
      throw new Error('Personal lorebooks belong to their persona and cannot be attached');
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO persona_lorebooks (persona_id, lorebook_id, created_at)
         VALUES (?, ?, ?)`
      )
      .run(personaId, lorebookId, new Date().toISOString());
  }

  detachBookForPersona(personaId: string, lorebookId: string): void {
    this.db
      .prepare(`DELETE FROM persona_lorebooks WHERE persona_id = ? AND lorebook_id = ?`)
      .run(personaId, lorebookId);
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
    if (!row) return null;
    return rowToEntry(row);
  }

  /** Bumps `hit_count` for every entry id actually selected into a turn's prompt -- called
   * from chatSession.ts after each lore scan. No record of which turn matched which entry,
   * just the running total, so a duplicate id in one turn (shouldn't happen -- an entry can
   * only be selected once per scan) would double-count; callers pass a de-duplicated list. */
  incrementHitCounts(entryIds: string[]): void {
    if (entryIds.length === 0) return;
    const stmt = this.db.prepare(`UPDATE lorebook_entries SET hit_count = hit_count + 1 WHERE id = ?`);
    transaction(this.db, () => {
      for (const id of entryIds) stmt.run(id);
    });
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
    const title = input.title ?? existing.title;

    this.db
      .prepare(
        `UPDATE lorebook_entries SET title = ?, keys = ?, enabled = ?, always_on = ?, priority = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        title,
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

  /** Reassigns entries to a different book. Titles and version content move with them as-is. */
  moveEntries(entryIds: string[], targetLorebookId: string): LorebookEntry[] {
    const target = this.getBook(targetLorebookId);
    if (!target) throw new Error(`Lorebook with id ${targetLorebookId} not found`);

    return transaction(this.db, () =>
      entryIds.map((entryId) => {
        const entry = this.getEntry(entryId);
        if (!entry) throw new Error(`Lorebook entry with id ${entryId} not found`);
        if (entry.lorebookId === targetLorebookId) return entry;

        this.db
          .prepare(`UPDATE lorebook_entries SET lorebook_id = ?, updated_at = ? WHERE id = ?`)
          .run(targetLorebookId, new Date().toISOString(), entryId);
        return this.getEntry(entryId)!;
      })
    );
  }

  /** Single-entry convenience wrapper around moveEntries. */
  moveEntry(entryId: string, targetLorebookId: string): LorebookEntry {
    return this.moveEntries([entryId], targetLorebookId)[0];
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

      const row = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`).get(id)!;
      return rowToVersion(row);
    });
  }

  updateVersionContent(versionId: string, content: string): LorebookEntryVersion {
    const existingRow = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`)
      .get(versionId);
    if (!existingRow) throw new Error(`Lorebook entry version with id ${versionId} not found`);

    this.db
      .prepare(`UPDATE lorebook_entry_versions SET content = ?, updated_at = ? WHERE id = ?`)
      .run(content, new Date().toISOString(), versionId);

    const row = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM lorebook_entry_versions WHERE id = ?`).get(versionId)!;
    return rowToVersion(row);
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
   * joined in directly rather than fetched through listEntries/getVersions.
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
      return {
        entry: rowToEntry(row),
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
        content: (row.activeContent as string | null) ?? '',
      };
    });
  }

  /**
   * Enabled entries from the persona's own personal book only -- excludes persona_lorebooks.
   * Feeds a character's normal reply. Use getEntriesForPersonaWithWorldBooks for "Suggest
   * reply", the one place persona-attached world lore should surface.
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
      return {
        entry: rowToEntry(row),
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
        content: (row.activeContent as string | null) ?? '',
      };
    });
  }

  /**
   * Enabled entries from the persona's attached world books plus its personal book -- the
   * persona equivalent of getEntriesForCharacter. Used only by "Suggest reply", not a
   * character's normal reply.
   */
  getEntriesForPersonaWithWorldBooks(personaId: string): EntryWithContent[] {
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
         WHERE e.enabled = 1
           AND (
             b.id IN (SELECT lorebook_id FROM persona_lorebooks WHERE persona_id = ?)
             OR (b.scope = 'personal' AND b.owner_persona_id = ?)
           )
         ORDER BY e.priority DESC, e.title`
      )
      .all(personaId, personaId);

    return rows.map((row) => {
      return {
        entry: rowToEntry(row),
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
        content: (row.activeContent as string | null) ?? '',
      };
    });
  }

  /**
   * World-book attachments plus personal books, keyed by the character or persona that
   * brings them into a conversation. Used by chat retention to match lore filters.
   */
  listLorebookIdsByOwner(): { byCharacterId: Record<string, string[]>; byPersonaId: Record<string, string[]> } {
    const byCharacterId: Record<string, string[]> = {};
    const byPersonaId: Record<string, string[]> = {};
    const add = (map: Record<string, string[]>, ownerId: string, lorebookId: string) => {
      const list = map[ownerId] ?? (map[ownerId] = []);
      if (!list.includes(lorebookId)) list.push(lorebookId);
    };

    const characterWorld = this.db
      .prepare(`SELECT character_id as ownerId, lorebook_id as lorebookId FROM character_lorebooks`)
      .all() as { ownerId: string; lorebookId: string }[];
    for (const row of characterWorld) add(byCharacterId, row.ownerId, row.lorebookId);

    const personaWorld = this.db
      .prepare(`SELECT persona_id as ownerId, lorebook_id as lorebookId FROM persona_lorebooks`)
      .all() as { ownerId: string; lorebookId: string }[];
    for (const row of personaWorld) add(byPersonaId, row.ownerId, row.lorebookId);

    const characterPersonal = this.db
      .prepare(
        `SELECT owner_character_id as ownerId, id as lorebookId
         FROM lorebooks WHERE scope = 'personal' AND owner_character_id IS NOT NULL`
      )
      .all() as { ownerId: string; lorebookId: string }[];
    for (const row of characterPersonal) add(byCharacterId, row.ownerId, row.lorebookId);

    const personaPersonal = this.db
      .prepare(
        `SELECT owner_persona_id as ownerId, id as lorebookId
         FROM lorebooks WHERE scope = 'personal' AND owner_persona_id IS NOT NULL`
      )
      .all() as { ownerId: string; lorebookId: string }[];
    for (const row of personaPersonal) add(byPersonaId, row.ownerId, row.lorebookId);

    return { byCharacterId, byPersonaId };
  }
}
