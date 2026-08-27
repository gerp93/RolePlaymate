import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getEffectiveDbPath } from '../dbLocation';
import { CHAT_DDL } from './chatSchema';
import { LOREBOOK_DDL } from './lorebookSchema';

let dbInstance: DatabaseSync | null = null;

export function initDatabase(dbPath?: string): DatabaseSync {
  dbPath = dbPath ?? getEffectiveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // Foreign keys are actually enforced here (unlike the old sql.js build, where the pragma
  // read back as 0), so the ON DELETE CASCADE declarations below do real work and services
  // no longer hand-roll cascade cleanup.
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });

  // WAL keeps writes incremental instead of rewriting the whole file. It creates `-wal` and
  // `-shm` sidecars next to the database; a clean close() checkpoints and removes them,
  // which is why relocating the database must close it first (see dbLocation.setDbPath).
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');

  dbInstance = db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- "fields" are content records (versioned personality/scenario/greeting text) -- every
    -- character gets exactly one of each field_type, created alongside the character itself.
    CREATE TABLE IF NOT EXISTS character_fields (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      field_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      UNIQUE (character_id, field_type)
    );

    CREATE TABLE IF NOT EXISTS character_field_versions (
      id TEXT PRIMARY KEY,
      field_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (field_id) REFERENCES character_fields(id) ON DELETE CASCADE,
      UNIQUE (field_id, version_number)
    );

    -- Enforces "one active version per field" at the DB level, not just in service code.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_field
      ON character_field_versions(field_id) WHERE is_active = 1;

    CREATE INDEX IF NOT EXISTS idx_fields_character ON character_fields(character_id);
    CREATE INDEX IF NOT EXISTS idx_field_versions_field ON character_field_versions(field_id);

    -- A character can have zero or more portrait images, ordered by position (0 = cover,
    -- shown on the character list tile). Replaces the old single \`characters.image_url\` column,
    -- which is left in place (unused going forward) purely so migrateLegacyPortraits below can
    -- still read pre-existing single portraits on upgrade.
    CREATE TABLE IF NOT EXISTS character_images (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      path TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_character_images_character ON character_images(character_id);
  `);

  db.exec(CHAT_DDL);
  db.exec(LOREBOOK_DDL);

  ensureColumn(db, 'characters', 'description', 'TEXT');
  ensureColumn(db, 'messages', 'selected_variant_id', 'TEXT REFERENCES message_variants(id) ON DELETE SET NULL');
  ensureColumn(db, 'messages', 'model', 'TEXT');
  ensureColumn(db, 'message_variants', 'model', 'TEXT');
  ensureColumn(db, 'message_variants', 'debug', 'TEXT');
  ensureColumn(db, 'conversation_memories', 'message_id', 'TEXT REFERENCES messages(id) ON DELETE CASCADE');
  ensureColumn(db, 'lorebooks', 'owner_persona_id', 'TEXT REFERENCES user_personas(id) ON DELETE CASCADE');
  ensureColumn(db, 'lorebooks', 'image', 'TEXT');
  // See the note in lorebookSchema.ts: this index has to wait until the column above is
  // guaranteed to exist, which for an upgraded database is only true after this line runs.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lorebooks_owner_persona ON lorebooks(owner_persona_id)`);
  migrateLegacyPortraits(db);

  console.log('Database initialized at:', dbPath);

  return db;
}

/** One-time upgrade path, generic form: adds `column` to `table` if a database created before
 * it existed doesn't have it yet. `columnDdl` is everything after the column name (type and
 * any constraints). */
function ensureColumn(db: DatabaseSync, table: string, column: string, columnDdl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const hasColumn = columns.some((c) => c.name === column);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDdl}`);
  }
}

/** One-time upgrade path: characters created before multi-image support had a single
 * `image_url` column. Adopt that value as each such character's first character_images row
 * (skipping any character that already has images, so this is safe to run on every startup). */
function migrateLegacyPortraits(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, image_url as imageUrl, created_at as createdAt FROM characters
       WHERE image_url IS NOT NULL AND image_url != ''
         AND id NOT IN (SELECT DISTINCT character_id FROM character_images)`
    )
    .all() as unknown as { id: string; imageUrl: string; createdAt: string }[];

  const insert = db.prepare(
    `INSERT INTO character_images (id, character_id, path, position, created_at) VALUES (?, ?, ?, 0, ?)`
  );
  for (const row of rows) {
    insert.run(uuidv4(), row.id, row.imageUrl, row.createdAt);
  }
}

/** Run `fn` inside a transaction, so multi-statement writes can't leave half-applied state.
 * Re-entrant: a nested call joins the transaction already in progress rather than issuing a
 * second BEGIN (which SQLite rejects) -- needed because some writes call into read helpers
 * that write themselves, e.g. duplicateVersion -> getVersionsByField -> ensureLatestIsActive. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) {
    return fn();
  }

  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getDatabase(): DatabaseSync | null {
  return dbInstance;
}

/** Closes the database, checkpointing the WAL and removing its `-wal`/`-shm` sidecars.
 * Idempotent -- safe to call from both `before-quit` and the database-relocation handlers. */
export function closeDatabase(): void {
  if (dbInstance?.isOpen) {
    dbInstance.close();
  }
  dbInstance = null;
}
