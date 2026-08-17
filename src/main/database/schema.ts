import initSqlJs, { Database } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

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

  saveDatabase(db, dbPath);

  console.log('Database initialized at:', dbPath);

  return db;
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
