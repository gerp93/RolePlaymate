import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getEffectiveDbPath } from '../dbLocation';
import { CHAT_DDL } from './chatSchema';
import { LOREBOOK_DDL } from './lorebookSchema';
import { hashPin, generateSalt } from './securityService';
import { DEFAULT_TEMPLATES } from '../chat/promptTemplates';
import { TEMPLATE_FIELD_KEYS } from '../../shared/types/promptTemplates';

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

    -- One row (id = 1): the salted hash of the "reveal hidden items" PIN, plus key_salt, used
    -- to derive the AES-256 key that actually encrypts hidden characters/personas/lorebooks at
    -- rest -- see securityService.ts. The PIN itself is never stored, and the verification
    -- hash and the encryption key are deliberately derived with different salts, so neither
    -- can be reconstructed from the other.
    CREATE TABLE IF NOT EXISTS app_security (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pin_hash BLOB NOT NULL,
      pin_salt BLOB NOT NULL,
      key_salt BLOB
    );

    -- One row (id = 1), one nullable column per stop-phrase setting -- see
    -- promptSettingsService.ts. NULL means "use the built-in default from promptTemplates.ts".
    -- The 7 system-prompt templates themselves used to live here as nullable TEXT columns too,
    -- but now get full version history like character fields -- see prompt_fields/
    -- prompt_field_versions below.
    CREATE TABLE IF NOT EXISTS prompt_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      stop_phrases_base TEXT,
      use_character_name_as_stop INTEGER,
      use_persona_name_as_stop INTEGER
    );

    -- The 7 PromptTemplates keys, as a fixed set of always-existing rows (like a character's
    -- personality/scenario/greeting fields) -- see promptFieldVersionService.ts.
    CREATE TABLE IF NOT EXISTS prompt_fields (
      id TEXT PRIMARY KEY,
      field_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_field_versions (
      id TEXT PRIMARY KEY,
      field_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (field_id) REFERENCES prompt_fields(id) ON DELETE CASCADE,
      UNIQUE (field_id, version_number)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_prompt_field
      ON prompt_field_versions(field_id) WHERE is_active = 1;
    CREATE INDEX IF NOT EXISTS idx_prompt_field_versions_field ON prompt_field_versions(field_id);

    -- One row per Ollama model tag with any customized sampler default -- see
    -- modelSamplerService.ts and the Model Tuning settings page. Every column but the key is
    -- nullable: a model with no row, or a row with some columns left null, falls back to
    -- DEFAULT_SAMPLERS (chatSession.ts) for whatever isn't set, same merge convention a
    -- chat-level override already uses over the global default. A model tag is the natural
    -- key -- there's exactly one tuning row per model, not a history to version.
    CREATE TABLE IF NOT EXISTS model_sampler_defaults (
      model TEXT PRIMARY KEY,
      temperature REAL,
      max_tokens INTEGER,
      top_p REAL,
      top_k INTEGER,
      repetition_penalty REAL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(CHAT_DDL);
  db.exec(LOREBOOK_DDL);

  ensureColumn(db, 'characters', 'description', 'TEXT');
  ensureColumn(db, 'characters', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'user_personas', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'lorebooks', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'messages', 'selected_variant_id', 'TEXT REFERENCES message_variants(id) ON DELETE SET NULL');
  ensureColumn(db, 'messages', 'model', 'TEXT');
  ensureColumn(db, 'message_variants', 'model', 'TEXT');
  ensureColumn(db, 'message_variants', 'debug', 'TEXT');
  ensureColumn(db, 'conversation_memories', 'message_id', 'TEXT REFERENCES messages(id) ON DELETE CASCADE');
  ensureColumn(db, 'lorebooks', 'owner_persona_id', 'TEXT REFERENCES user_personas(id) ON DELETE CASCADE');
  ensureColumn(db, 'lorebooks', 'image', 'TEXT');
  ensureColumn(db, 'app_security', 'key_salt', 'BLOB');
  ensureColumn(db, 'conversations', 'character_image_mode', `TEXT NOT NULL DEFAULT 'carousel'`);
  ensureColumn(db, 'conversations', 'character_image_id', 'TEXT REFERENCES character_images(id) ON DELETE SET NULL');
  ensureColumn(db, 'conversations', 'persona_image_mode', `TEXT NOT NULL DEFAULT 'carousel'`);
  ensureColumn(db, 'conversations', 'persona_image_id', 'TEXT REFERENCES persona_images(id) ON DELETE SET NULL');
  // The non-static mode was originally called 'random' (reroll per message); it's since become
  // 'carousel' (auto-cycle every 10s in the margin portraits). ensureColumn only sets the
  // DEFAULT for brand-new databases, so existing rows written under the old default need a
  // one-time rename to the new value they now mean.
  db.exec(`UPDATE conversations SET character_image_mode = 'carousel' WHERE character_image_mode = 'random'`);
  db.exec(`UPDATE conversations SET persona_image_mode = 'carousel' WHERE persona_image_mode = 'random'`);
  // See the note in lorebookSchema.ts: this index has to wait until the column above is
  // guaranteed to exist, which for an upgraded database is only true after this line runs.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lorebooks_owner_persona ON lorebooks(owner_persona_id)`);
  migrateLegacyPortraits(db);
  migrateLegacyPersonaAvatars(db);
  migratePersonaBackgroundToVersions(db);
  seedDefaultPin(db);
  backfillKeySalt(db);
  seedPromptFields(db);

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

/** One-time upgrade path: personas created before the gallery existed had a single `avatar`
 * column. Adopt that value as each such persona's first persona_images row (skipping any
 * persona that already has images), mirroring migrateLegacyPortraits above. */
function migrateLegacyPersonaAvatars(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, avatar, created_at as createdAt FROM user_personas
       WHERE avatar IS NOT NULL AND avatar != ''
         AND id NOT IN (SELECT DISTINCT persona_id FROM persona_images)`
    )
    .all() as unknown as { id: string; avatar: string; createdAt: string }[];

  const insert = db.prepare(
    `INSERT INTO persona_images (id, persona_id, path, position, created_at) VALUES (?, ?, ?, 0, ?)`
  );
  for (const row of rows) {
    insert.run(uuidv4(), row.id, row.avatar, row.createdAt);
  }
}

/** One-time upgrade path: personas created before background versioning existed have their
 * history in a single `background` column. Adopt that value verbatim as each such persona's
 * v1, active (skipping any persona that already has background versions) -- verbatim because
 * the column is already correctly encrypted-if-hidden, so this is a straight copy, not a
 * decrypt/re-encrypt. Real user data becoming history, unlike seedPromptFields' fresh-default
 * seed -- nothing here is lost. Going forward `user_personas.background` is left unwritten,
 * same convention as `avatar` above; conversationService reads the active version instead. */
function migratePersonaBackgroundToVersions(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, background, created_at as createdAt FROM user_personas
       WHERE id NOT IN (SELECT DISTINCT persona_id FROM persona_background_versions)`
    )
    .all() as unknown as { id: string; background: string | null; createdAt: string }[];

  const insert = db.prepare(
    `INSERT INTO persona_background_versions (id, persona_id, version_number, content, is_active, created_at, updated_at)
     VALUES (?, ?, 1, ?, 1, ?, ?)`
  );
  for (const row of rows) {
    insert.run(uuidv4(), row.id, row.background ?? '', row.createdAt, row.createdAt);
  }
}

/** One-time seed: a fresh database (or one from before this feature existed) gets the
 * default PIN "1234" so the reveal-hidden toggle works out of the box. Safe to call on
 * every startup -- it's a no-op once the row exists. */
function seedDefaultPin(db: DatabaseSync): void {
  const row = db.prepare(`SELECT id FROM app_security WHERE id = 1`).get();
  if (row) return;

  const { hash, salt } = hashPin('1234');
  db.prepare(`INSERT INTO app_security (id, pin_hash, pin_salt, key_salt) VALUES (1, ?, ?, ?)`).run(
    hash,
    salt,
    generateSalt()
  );
}

/** One-time upgrade path: a database from before real encryption existed has an app_security
 * row (from seedDefaultPin's earlier, key_salt-less version) with no key_salt yet. Nothing
 * could have been encrypted under it at that point, so backfilling a fresh one is safe. */
function backfillKeySalt(db: DatabaseSync): void {
  const row = db.prepare(`SELECT key_salt as keySalt FROM app_security WHERE id = 1`).get() as
    | { keySalt: Uint8Array | null }
    | undefined;
  if (row && row.keySalt == null) {
    db.prepare(`UPDATE app_security SET key_salt = ? WHERE id = 1`).run(generateSalt());
  }
}

/** One-time seed (idempotent, safe on every startup): each of the 7 PromptTemplates keys gets
 * a `prompt_fields` row if missing, and if that field has zero versions yet, a version 1
 * containing the built-in default text, active. Version 1 is then permanently "what the
 * original default was" -- a later "Reset to Default" always inserts a *new* version rather
 * than touching v1, so it stays a stable reference point even after DEFAULT_TEMPLATES changes
 * in a future release. */
function seedPromptFields(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insertField = db.prepare(
    `INSERT OR IGNORE INTO prompt_fields (id, field_key, created_at, updated_at) VALUES (?, ?, ?, ?)`
  );
  const getField = db.prepare(`SELECT id FROM prompt_fields WHERE field_key = ?`);
  const countVersions = db.prepare(`SELECT COUNT(*) as n FROM prompt_field_versions WHERE field_id = ?`);
  const insertVersion = db.prepare(
    `INSERT INTO prompt_field_versions (id, field_id, version_number, content, is_active, created_at, updated_at)
     VALUES (?, ?, 1, ?, 1, ?, ?)`
  );

  for (const fieldKey of TEMPLATE_FIELD_KEYS) {
    insertField.run(uuidv4(), fieldKey, now, now);
    const field = getField.get(fieldKey) as { id: string };
    const { n } = countVersions.get(field.id) as { n: number };
    if (n === 0) {
      insertVersion.run(uuidv4(), field.id, DEFAULT_TEMPLATES[fieldKey], now, now);
    }
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
