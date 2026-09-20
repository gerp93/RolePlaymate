import * as fs from 'fs';
import Database from 'better-sqlite3-multiple-ciphers';

/**
 * The one place the SQLite driver is named. Every service imports `DatabaseSync` from here
 * rather than from the driver, so the driver stays swappable and the encryption pragmas
 * (see `openDatabase`) live next to the import they depend on.
 *
 * This is `better-sqlite3-multiple-ciphers`, chosen over `node:sqlite` because node's built-in
 * has no cipher support -- whole-file encryption needs SQLCipher-compatible page encryption.
 * The name `DatabaseSync` is kept from the old driver so the ~20 services didn't need touching
 * beyond their import line; the two drivers' prepare/run/get/all/exec surface is the same.
 */
type Row = Record<string, unknown>;
type BindValue = string | number | bigint | Buffer | Uint8Array | null;

/** Row-typed statement: the driver's own types return `unknown` from get/all, whereas every
 * caller (written against node:sqlite) treats a row as a plain record and casts from there. */
export interface StatementSync {
  run(...params: BindValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: BindValue[]): Row | undefined;
  all(...params: BindValue[]): Row[];
}

export type DatabaseSync = Omit<Database.Database, 'prepare'> & {
  prepare(sql: string): StatementSync;
};

const SQLCIPHER_PRAGMAS = ["cipher='sqlcipher'", 'legacy=4'];

/**
 * Opens `dbPath`, optionally unlocking it with `password`. Throws when the file is encrypted
 * and the password is wrong or missing ("file is not a database"), or when it isn't a
 * database at all -- callers treat the wrong-password case as an expected outcome.
 *
 * The password goes through SQLCipher's own KDF (PBKDF2-HMAC-SHA512, 256k iterations, salt
 * stored in the file header), so nothing about the key needs to live outside the database.
 */
export function openDatabase(dbPath: string, password?: string): DatabaseSync {
  const db = new Database(dbPath);
  try {
    if (password !== undefined) {
      for (const pragma of SQLCIPHER_PRAGMAS) db.pragma(pragma);
      // Passed as a quoted SQL string literal; embedded quotes are doubled so a password
      // containing `'` can't break out of it.
      db.pragma(`key='${password.replace(/'/g, "''")}'`);
    }
    // The key is only actually checked on the first read -- force one so a wrong password
    // fails here, not in some later query.
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    db.pragma('foreign_keys = ON');
    return db as unknown as DatabaseSync;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** True when the file at `dbPath` starts with the plain SQLite magic header, i.e. is NOT
 * encrypted. An encrypted file's first bytes are random, so this is how the app tells the two
 * apart before any password is known. A missing or empty file counts as plain. */
export function isPlainSqliteFile(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) return true;
  const fd = fs.openSync(dbPath, 'r');
  try {
    const header = Buffer.alloc(16);
    const read = fs.readSync(fd, header, 0, 16, 0);
    if (read === 0) return true;
    return header.toString('latin1', 0, 15) === 'SQLite format 3';
  } finally {
    fs.closeSync(fd);
  }
}
