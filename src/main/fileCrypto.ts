import * as fs from 'fs';
import * as path from 'path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Encryption for the portrait and spoken-audio files that live beside the database. The
 * database itself is encrypted by the SQLite driver (see database/sqlite.ts); these are plain
 * files, so they get the same treatment file-by-file: AES-256-GCM under a random key that is
 * stored INSIDE the encrypted database (see appEncryption.ts). Keeping the key there rather
 * than deriving it from the password means changing the password never touches these files.
 *
 * Format: 8-byte magic | 12-byte IV | 16-byte GCM tag | ciphertext.
 *
 * Every read goes through `readLibraryFile`, which decrypts only when the magic is present, so
 * a folder in a mixed state -- half encrypted after an interrupted enable/disable, or holding
 * a plain file the user dropped in -- keeps working instead of failing.
 */

const MAGIC = Buffer.from('RPENC1\0\0', 'latin1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + IV_LENGTH + TAG_LENGTH;

/** Set while encryption is on (loaded from the database at unlock); null when it's off. New
 * files are written encrypted exactly when this is set. Never persisted outside the database
 * and never sent to the renderer. */
let fileKey: Buffer | null = null;

export function setFileKey(key: Buffer | null): void {
  fileKey?.fill(0);
  fileKey = key;
}

export function generateFileKey(): Buffer {
  return randomBytes(32);
}

export function isEncryptedBuffer(buf: Buffer): boolean {
  return buf.length >= HEADER_LENGTH && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

function encryptBuffer(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decryptBuffer(buf: Buffer, key: Buffer): Buffer {
  const iv = buf.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const tag = buf.subarray(MAGIC.length + IV_LENGTH, HEADER_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(HEADER_LENGTH)), decipher.final()]);
}

/** File contents, decrypted if the file is one of ours. Throws for an encrypted file when no
 * key is loaded -- a locked app must never hand ciphertext to a renderer as if it were an image. */
export function readLibraryFile(filePath: string): Buffer {
  const raw = fs.readFileSync(filePath);
  if (!isEncryptedBuffer(raw)) return raw;
  if (!fileKey) throw new Error('This file is encrypted and the app is locked');
  return decryptBuffer(raw, fileKey);
}

/** Encrypts `filePath` in place when encryption is on and it isn't already encrypted. Called
 * right after anything writes or copies a file into the library. Written to a temp name and
 * renamed so a crash mid-write can't leave a truncated half-file under the real name. */
export function protectLibraryFile(filePath: string): void {
  if (!fileKey) return;
  rewriteIfNeeded(filePath, (raw) => (isEncryptedBuffer(raw) ? null : encryptBuffer(raw, fileKey!)));
}

function rewriteIfNeeded(filePath: string, transform: (raw: Buffer) => Buffer | null): void {
  const raw = fs.readFileSync(filePath);
  const next = transform(raw);
  if (!next) return;
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, filePath);
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile() && !entry.name.includes('.tmp-')) out.push(full);
  }
  return out;
}

/** Encrypts every not-yet-encrypted file under `dir`. Idempotent, so an interrupted run is
 * finished by simply running it again. Returns how many files it changed. */
export function encryptDirectory(dir: string, key: Buffer): number {
  let changed = 0;
  for (const file of listFiles(dir)) {
    rewriteIfNeeded(file, (raw) => {
      if (isEncryptedBuffer(raw)) return null;
      changed++;
      return encryptBuffer(raw, key);
    });
  }
  return changed;
}

/** Inverse of encryptDirectory: turns every encrypted file back into plain bytes. */
export function decryptDirectory(dir: string, key: Buffer): number {
  let changed = 0;
  for (const file of listFiles(dir)) {
    rewriteIfNeeded(file, (raw) => {
      if (!isEncryptedBuffer(raw)) return null;
      changed++;
      return decryptBuffer(raw, key);
    });
  }
  return changed;
}
