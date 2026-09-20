import { createDecipheriv, scryptSync } from 'node:crypto';
import type { DatabaseSync } from './sqlite';
import { transaction } from './schema';

/**
 * One-time upgrade from the old per-row hidden-content encryption.
 *
 * Before whole-app encryption existed, hiding a character, persona, world book, or scenario
 * encrypted its text columns with an AES-256-GCM key derived from the hidden-items PIN. That
 * scheme is gone: hiding is now only a privacy screen, and real encryption covers the whole
 * database. This module is the ONLY code that still knows the old format -- it exists solely
 * to turn existing `v1:` ciphertext back into plain text, once, so those rows stay readable.
 *
 * Ciphertext identifies itself (prefix + GCM tag), so every candidate column is scanned
 * regardless of its row's hidden flag, and a value that merely starts with "v1:" but doesn't
 * authenticate is left untouched rather than mangled. Safe to delete this file, and the call
 * to it in main.ts, once no install can still be running the old format.
 */

const PREFIX = 'v1:';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
/** Smallest possible payload: IV + tag with an empty plaintext. Anything shorter that happens
 * to start with "v1:" (a user's own note, say) can't be ciphertext. */
const MIN_PAYLOAD_BYTES = IV_LENGTH + TAG_LENGTH;

/** The migration marker. Nothing else in the app uses SQLite's `user_version`. */
const MIGRATED_VERSION = 1;

interface Target {
  table: string;
  columns: string[];
}

/** Every column the old scheme could have encrypted -- the union of what each service's
 * rekey method used to touch. */
const TARGETS: Target[] = [
  { table: 'characters', columns: ['name', 'description'] },
  { table: 'character_field_versions', columns: ['content'] },
  { table: 'user_personas', columns: ['name', 'description'] },
  { table: 'persona_background_versions', columns: ['content'] },
  { table: 'scenarios', columns: ['name', 'description'] },
  { table: 'scenario_versions', columns: ['content'] },
  { table: 'scenario_greeting_versions', columns: ['content'] },
  { table: 'lorebooks', columns: ['name', 'description'] },
  { table: 'lorebook_entries', columns: ['title'] },
  { table: 'lorebook_entry_versions', columns: ['content'] },
];

function looksLikeCiphertext(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return false;
  return Buffer.from(value.slice(PREFIX.length), 'base64').length >= MIN_PAYLOAD_BYTES;
}

function tryDecrypt(value: string, key: Buffer): string | null {
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_LENGTH));
    decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** True once the migration has been run (or found unnecessary) on this database. */
export function isLegacyDecryptDone(db: DatabaseSync): boolean {
  return (db.pragma('user_version', { simple: true }) as number) >= MIGRATED_VERSION;
}

function markDone(db: DatabaseSync): void {
  db.pragma(`user_version = ${MIGRATED_VERSION}`);
}

/** Whether any column still holds old-format ciphertext. Records "done" itself when none
 * does, so a fresh or never-hidden library is never asked about a PIN. */
export function needsLegacyDecrypt(db: DatabaseSync): boolean {
  if (isLegacyDecryptDone(db)) return false;
  for (const { table, columns } of TARGETS) {
    for (const column of columns) {
      const rows = db
        .prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE 'v1:%'`)
        .all() as { v: unknown }[];
      if (rows.some((row) => looksLikeCiphertext(row.v))) return true;
    }
  }
  markDone(db);
  return false;
}

/** The old encryption key: scrypt(pin, key_salt), exactly as the old SecurityService did. */
function deriveLegacyKey(db: DatabaseSync, pin: string): Buffer | null {
  const row = db.prepare('SELECT key_salt FROM app_security WHERE id = 1').get();
  if (!row || row.key_salt == null) return null;
  return scryptSync(pin, Buffer.from(row.key_salt as Uint8Array), 32);
}

/**
 * Decrypts every old-format value using `pin`, in one transaction, then records completion.
 * The caller must already have checked the PIN against its stored hash. Returns how many
 * values were decrypted. Values that don't authenticate are left as they were.
 */
export function decryptLegacyContent(db: DatabaseSync, pin: string): number {
  const key = deriveLegacyKey(db, pin);
  if (!key) {
    markDone(db);
    return 0;
  }

  let count = 0;
  transaction(db, () => {
    for (const { table, columns } of TARGETS) {
      for (const column of columns) {
        const rows = db
          .prepare(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} LIKE 'v1:%'`)
          .all() as { id: string; v: unknown }[];
        const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
        for (const row of rows) {
          if (!looksLikeCiphertext(row.v)) continue;
          const plain = tryDecrypt(row.v, key);
          if (plain === null) continue;
          update.run(plain, row.id);
          count++;
        }
      }
    }
    markDone(db);
  });
  key.fill(0);
  return count;
}
