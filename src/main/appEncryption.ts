import type { DatabaseSync } from './database/sqlite';
import { isPlainSqliteFile, openDatabase } from './database/sqlite';
import { transaction } from './database/schema';
import {
  decryptDirectory,
  encryptDirectory,
  generateFileKey,
  setFileKey,
} from './fileCrypto';
import { getImageLibraryDirs } from './images';
import { getTtsLibraryDirs } from './ttsAudio';

/**
 * Optional whole-app encryption. Off by default; the user turns it on from Settings with a
 * password. When on, the SQLite file is encrypted page-by-page by the driver and the portrait
 * and audio files are encrypted by fileCrypto.ts, so nothing readable is left on disk.
 *
 * There is deliberately no "encryption enabled" flag anywhere: the database file itself is the
 * source of truth (an encrypted file has no SQLite header -- see `isPlainSqliteFile`), so the
 * setting can't drift from reality and the app can decide whether to ask for a password before
 * it has opened anything.
 *
 * A forgotten password is unrecoverable by design. There is no escrow, no reset, no backdoor.
 */

export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;

const SQLCIPHER_PRAGMAS = ["cipher='sqlcipher'", 'legacy=4'];

function quoteKey(value: string): string {
  return value.replace(/'/g, "''");
}

export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'Enter a password';
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

/** True when the database file at `dbPath` is encrypted. Safe to call before opening it. */
export function isDatabaseEncrypted(dbPath: string): boolean {
  return !isPlainSqliteFile(dbPath);
}

/** Checks a password by opening a second, throwaway connection rather than remembering the
 * one the user typed at launch -- so the app never holds the password after unlock. The KDF
 * is deliberately slow, which is also what limits guessing through this path. */
export function verifyPassword(dbPath: string, password: string): boolean {
  try {
    openDatabase(dbPath, password).close();
    return true;
  } catch {
    return false;
  }
}

/** Every library folder, not just the current ones: portraits and clips from before the
 * RolePlaymate_Data layout still live in `userData/images` and `userData/tts`, and skipping them
 * on disable would strand encrypted files that nothing could read once the key row is gone. */
function libraryDirs(): string[] {
  return [...getImageLibraryDirs(), ...getTtsLibraryDirs()];
}

function encryptLibrary(key: Buffer): void {
  for (const dir of libraryDirs()) encryptDirectory(dir, key);
}

function decryptLibrary(key: Buffer): void {
  for (const dir of libraryDirs()) decryptDirectory(dir, key);
}

function readFileKey(db: DatabaseSync): Buffer | null {
  const row = db.prepare('SELECT file_key FROM app_secrets WHERE id = 1').get();
  return row ? Buffer.from(row.file_key as Uint8Array) : null;
}

/**
 * Called once, right after the database opens, to bring the file-key state in line with the
 * database's. Encrypted DB: load (or create) the key so files can be read and written. Plain
 * DB: a leftover key row means an enable or disable was interrupted; either way the
 * consistent end state is "off", so finish it by decrypting any stray encrypted files.
 */
export function initFileEncryption(db: DatabaseSync, dbEncrypted: boolean): void {
  const existing = readFileKey(db);

  if (dbEncrypted) {
    const key = existing ?? generateFileKey();
    if (!existing) {
      db.prepare('INSERT INTO app_secrets (id, file_key) VALUES (1, ?)').run(key);
    }
    setFileKey(key);
    // Cheap when nothing needs doing (a directory listing and a 8-byte prefix check per file);
    // finishes an enable that was interrupted after the database was already encrypted.
    encryptLibrary(key);
    return;
  }

  setFileKey(null);
  if (existing) {
    decryptLibrary(existing);
    db.prepare('DELETE FROM app_secrets WHERE id = 1').run();
  }
}

/** WAL mode can't be rekeyed in place, so drop to DELETE mode around the change and switch
 * back. Leaves the connection open and usable under the new key. */
function rekey(db: DatabaseSync, newPassword: string): void {
  db.pragma('journal_mode = DELETE');
  db.pragma(`rekey='${quoteKey(newPassword)}'`);
  db.pragma('journal_mode = WAL');
}

/** Encrypts the currently-open plain database and the library files in place. Order matters
 * for crash safety: the file key is written and the files encrypted BEFORE the database is
 * rekeyed, so a crash leaves a plain database plus some encrypted files -- a state
 * `initFileEncryption` and `readLibraryFile` both tolerate -- rather than an encrypted
 * database whose files can't be read. */
export function enableEncryption(db: DatabaseSync, password: string): void {
  const problem = validateNewPassword(password);
  if (problem) throw new Error(problem);
  if (isDatabaseEncrypted(db.name)) throw new Error('Encryption is already on');

  const key = readFileKey(db) ?? generateFileKey();
  transaction(db, () => {
    db.prepare('INSERT OR REPLACE INTO app_secrets (id, file_key) VALUES (1, ?)').run(key);
  });
  setFileKey(key);
  encryptLibrary(key);

  for (const pragma of SQLCIPHER_PRAGMAS) db.pragma(pragma);
  rekey(db, password);
}

/** Changes the password. Files are untouched -- their key is independent of the password. */
export function changePassword(db: DatabaseSync, currentPassword: string, newPassword: string): void {
  const problem = validateNewPassword(newPassword);
  if (problem) throw new Error(problem);
  if (!verifyPassword(db.name, currentPassword)) throw new Error('Current password is incorrect');
  rekey(db, newPassword);
}

/** Removes encryption: files first, then the database, then the key row (which can only be
 * deleted after the database is plain, since it lives in it). */
export function disableEncryption(db: DatabaseSync, currentPassword: string): void {
  if (!verifyPassword(db.name, currentPassword)) throw new Error('Password is incorrect');

  const key = readFileKey(db);
  if (key) {
    decryptLibrary(key);
  }
  rekey(db, '');
  db.prepare('DELETE FROM app_secrets WHERE id = 1').run();
  setFileKey(null);
}
