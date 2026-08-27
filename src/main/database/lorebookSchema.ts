/**
 * Lorebooks: reference material injected into the prompt only when the conversation is
 * actually about it, so a large setting doesn't have to live in the character's fields and
 * burn context on every turn.
 *
 * Two scopes, same storage, different meaning in the prompt:
 *
 *  - **world** — shared world-building. Many-to-many with characters (via
 *    `character_lorebooks`), so one "Kestrel setting" book serves every character in that
 *    world. Injected as *common knowledge*.
 *  - **personal** — one character's private history, owned outright by that character.
 *    Injected as things *that character* remembers, explicitly not common knowledge. The
 *    distinction matters: a model told "the mutiny happened" as world fact will let anyone
 *    reference it, whereas "you remember the mutiny" keeps it in the character's head.
 *
 * Entry content is versioned exactly like character fields -- same history, active-version
 * marker and partial unique index -- so lore gets the same editing model as the rest of the
 * app rather than being a second-class plain-text store.
 */
export const LOREBOOK_DDL = `
  CREATE TABLE IF NOT EXISTS lorebooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    -- 'world' | 'personal'
    scope TEXT NOT NULL DEFAULT 'world',
    -- Set only for personal books; a personal book dies with its character.
    owner_character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
    -- Set only for a persona's personal book -- the persona equivalent of owner_character_id.
    -- Exactly one of the two owner columns is set when scope = 'personal', enforced in
    -- application code rather than a CHECK constraint, matching the rest of this schema.
    owner_persona_id TEXT REFERENCES user_personas(id) ON DELETE CASCADE,
    -- World books only: an optional cover image, same convention as a persona's avatar --
    -- one path, not a gallery like characters get.
    image TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_lorebooks_owner ON lorebooks(owner_character_id);
  -- idx_lorebooks_owner_persona is NOT created here: on a database from before this column
  -- existed, this DDL runs against the table as it already is, and CREATE INDEX validates the
  -- column exists immediately -- unlike CREATE TABLE IF NOT EXISTS, there's no "IF NOT EXISTS
  -- on the column" escape hatch. It's created in schema.ts, after the migration that adds the
  -- column has actually run.

  -- World books only. A personal book reaches its character through owner_character_id and
  -- is deliberately never listed here, so "attached books" and "my own history" can't blur.
  CREATE TABLE IF NOT EXISTS character_lorebooks (
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (character_id, lorebook_id)
  );

  CREATE INDEX IF NOT EXISTS idx_character_lorebooks_book ON character_lorebooks(lorebook_id);

  CREATE TABLE IF NOT EXISTS lorebook_entries (
    id TEXT PRIMARY KEY,
    lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    -- Comma-separated trigger keywords. Stored as authored so the editor can round-trip
    -- them; parsing and matching happen in loreMatcher.
    keys TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    -- Injected every turn regardless of keys -- for the handful of facts that are always
    -- relevant and would be a bug to miss.
    always_on INTEGER NOT NULL DEFAULT 0,
    -- Higher wins when the token budget can't fit everything that matched.
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_lorebook_entries_book ON lorebook_entries(lorebook_id);

  -- Mirrors character_field_versions, down to the partial unique index.
  CREATE TABLE IF NOT EXISTS lorebook_entry_versions (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES lorebook_entries(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (entry_id, version_number)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_entry
    ON lorebook_entry_versions(entry_id) WHERE is_active = 1;

  CREATE INDEX IF NOT EXISTS idx_lorebook_entry_versions_entry
    ON lorebook_entry_versions(entry_id);
`;
