import initSqlJs, { Database } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getEffectiveDbPath } from '../dbLocation';

let dbInstance: Database | null = null;
let currentDbPath: string | null = null;

export async function initDatabase(dbPath?: string): Promise<Database> {
  const SQL = await initSqlJs();
  dbPath = dbPath ?? getEffectiveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  let db: Database;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  dbInstance = db;
  currentDbPath = dbPath;

  // Harmless to set, but sql.js's bundled SQLite build doesn't actually enforce this --
  // PRAGMA foreign_keys reads back as 0 regardless -- so ON DELETE CASCADE never fires.
  // Every service that deletes a row with dependents cleans them up explicitly instead.
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  ensureDescriptionColumn(db);

  // "fields" are content records (versioned personality/scenario/greeting text) -- every
  // character gets exactly one of each field_type, created alongside the character itself.
  db.run(`
    CREATE TABLE IF NOT EXISTS character_fields (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      field_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      UNIQUE (character_id, field_type)
    )
  `);

  db.run(`
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
    )
  `);

  // Enforces "one active version per field" at the DB level, not just in service code.
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_field
      ON character_field_versions(field_id) WHERE is_active = 1
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_fields_character ON character_fields(character_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_field_versions_field ON character_field_versions(field_id)`);

  // A character can have zero or more portrait images, ordered by position (0 = cover,
  // shown on the character list tile). Replaces the old single `characters.image_url` column,
  // which is left in place (unused going forward) purely so migrateLegacyPortraits below can
  // still read pre-existing single portraits on upgrade.
  db.run(`
    CREATE TABLE IF NOT EXISTS character_images (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      path TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_character_images_character ON character_images(character_id)`);

  migrateLegacyPortraits(db);

  saveDatabase(db, dbPath);

  console.log('Database initialized at:', dbPath);

  return db;
}

/** One-time upgrade path: characters created before the description field existed have no
 * `description` column -- add it (as NULL for existing rows) if it isn't already there. */
function ensureDescriptionColumn(db: Database): void {
  const stmt = db.prepare(`PRAGMA table_info(characters)`);
  let hasDescription = false;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    if (row.name === 'description') {
      hasDescription = true;
      break;
    }
  }
  stmt.free();

  if (!hasDescription) {
    db.run(`ALTER TABLE characters ADD COLUMN description TEXT`);
  }
}

/** One-time upgrade path: characters created before multi-image support had a single
 * `image_url` column. Adopt that value as each such character's first character_images row
 * (skipping any character that already has images, so this is safe to run on every startup). */
function migrateLegacyPortraits(db: Database): void {
  const stmt = db.prepare(`
    SELECT id, image_url, created_at FROM characters
    WHERE image_url IS NOT NULL AND image_url != ''
      AND id NOT IN (SELECT DISTINCT character_id FROM character_images)
  `);
  const rows: { id: string; imageUrl: string; createdAt: string }[] = [];
  while (stmt.step()) {
    const [id, imageUrl, createdAt] = stmt.get();
    rows.push({ id: id as string, imageUrl: imageUrl as string, createdAt: createdAt as string });
  }
  stmt.free();

  for (const row of rows) {
    db.run(
      `INSERT INTO character_images (id, character_id, path, position, created_at) VALUES (?, ?, ?, 0, ?)`,
      [uuidv4(), row.id, row.imageUrl, row.createdAt]
    );
  }
}

export function saveDatabase(db: Database, dbPath?: string): void {
  if (!dbPath) {
    dbPath = currentDbPath ?? getEffectiveDbPath();
  }
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export function getDatabase(): Database | null {
  return dbInstance;
}
