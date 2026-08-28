import { DatabaseSync } from 'node:sqlite';
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 20;

const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM standard nonce size
const AUTH_TAG_LENGTH = 16;

// Prefix marks a value as this scheme's ciphertext. Anything hidden that DOESN'T start with
// this (a legacy row from before encryption existed, or a value that was never touched) is
// treated as plaintext -- see decryptIfHidden and migrateLegacyContent.
const CIPHER_PREFIX = 'v1:';

/** scrypt is a Node built-in (no bcrypt dependency needed) and is deliberately slow, which is
 * the point for a PIN with only 10^4-10^20 possible values -- a fast hash would make offline
 * brute-forcing the stored hash trivial. Used for both the verification hash and (with a
 * separate salt) the encryption key, so the two are never the same derived bytes. */
export function hashPin(pin: string): { hash: Buffer; salt: Buffer } {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64);
  return { hash, salt };
}

export function generateSalt(): Buffer {
  return randomBytes(16);
}

function isValidPinLength(pin: string): boolean {
  return pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;
}

/**
 * Owns the PIN's verification hash, the encryption key derived from it, and the low-level
 * AES-256-GCM primitives everything else builds on. The derived key lives only in memory
 * (`cachedKey`), set by `unlock()` and zeroed by `lock()` -- it is never persisted and never
 * crosses the IPC bridge to the renderer.
 *
 * Deliberately does NOT know about characters/personas/lorebooks: the bulk "encrypt/decrypt
 * everything hidden" operations (hide/unhide, PIN-change rekeying) are orchestrated by the
 * services that own those tables (or by main.ts for the cross-service PIN-change case), each
 * calling back into the primitives here. Keeping this file table-agnostic is what keeps it a
 * single, auditable place for the actual cryptography.
 */
export class SecurityService {
  private cachedKey: Buffer | null = null;

  constructor(private db: DatabaseSync) {}

  verifyPin(pin: string): boolean {
    const row = this.db
      .prepare(`SELECT pin_hash as pinHash, pin_salt as pinSalt FROM app_security WHERE id = 1`)
      .get() as { pinHash: Uint8Array; pinSalt: Uint8Array } | undefined;
    if (!row) return false;

    const candidate = scryptSync(pin, Buffer.from(row.pinSalt), 64);
    const stored = Buffer.from(row.pinHash);
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
  }

  /** scrypt(pin, key_salt) -- the encryption key, independent of the verification hash above. */
  deriveKey(pin: string): Buffer {
    const row = this.db.prepare(`SELECT key_salt as keySalt FROM app_security WHERE id = 1`).get() as
      | { keySalt: Uint8Array }
      | undefined;
    if (!row) throw new Error('No PIN has been set');
    return scryptSync(pin, Buffer.from(row.keySalt), KEY_LENGTH);
  }

  /** Verifies the PIN, caches the derived key for the session, and sweeps any hidden content
   * still sitting in plaintext from before this feature existed. Returns false (rather than
   * throwing) on a wrong PIN, since that's an expected outcome, not an error. */
  unlock(pin: string): boolean {
    if (!this.verifyPin(pin)) return false;
    this.cachedKey = this.deriveKey(pin);
    return true;
  }

  /** Drops the cached key. Zeroed rather than just dereferenced, so a stale copy doesn't
   * linger in the buffer's backing memory any longer than necessary. */
  lock(): void {
    this.cachedKey?.fill(0);
    this.cachedKey = null;
  }

  isUnlocked(): boolean {
    return this.cachedKey !== null;
  }

  /** Whether `value` is this scheme's ciphertext format, vs. plaintext (legacy-unmigrated, or
   * simply empty). Exposed so hide/unhide cascades can decide encrypt-vs-decrypt per row
   * without duplicating the `v1:` prefix convention outside this file. */
  isEncrypted(value: string): boolean {
    return value.startsWith(CIPHER_PREFIX);
  }

  private requireKey(): Buffer {
    if (!this.cachedKey) throw new Error('Locked: the PIN must be unlocked before this content can be accessed');
    return this.cachedKey;
  }

  encrypt(plaintext: string): string {
    return this.encryptWithKey(plaintext, this.requireKey());
  }

  decrypt(ciphertext: string): string {
    return this.decryptWithKey(ciphertext, this.requireKey());
  }

  private encryptWithKey(plaintext: string, key: Buffer): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return CIPHER_PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decryptWithKey(ciphertext: string, key: Buffer): string {
    const raw = Buffer.from(ciphertext.slice(CIPHER_PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  /** Read-path helper for row mappers: passes plaintext straight through when the owning row
   * isn't hidden, and treats anything hidden that isn't in this scheme's format (no `v1:`
   * prefix) as not-yet-migrated legacy plaintext rather than attempting to decrypt it -- see
   * migrateLegacyContent, which is what actually re-encrypts those. Lenient by design: a list
   * read must never throw just because the session happens to be locked, since the renderer's
   * own hidden-item filter (unrelated to decryption) is what keeps a locked row off-screen. */
  decryptIfHidden(value: string, isHidden: boolean): string {
    if (!isHidden) return value;
    if (!value.startsWith(CIPHER_PREFIX)) return value; // legacy plaintext, or empty string
    if (!this.cachedKey) return value; // locked -- caller's list filter hides this row anyway
    try {
      return this.decrypt(value);
    } catch {
      // Corrupt/unreadable ciphertext must not crash an entire list read -- surface the raw
      // value rather than taking down every other row alongside it.
      return value;
    }
  }

  /** Write-path helper: passes plaintext straight through when not hidden. When hidden,
   * requires the key -- unlike the read side, a write must never silently store plaintext (or
   * garbage) under a hidden flag, so this throws rather than degrading. */
  encryptIfHidden(value: string, isHidden: boolean): string {
    if (!isHidden) return value;
    return this.encrypt(value);
  }

  /** One field's worth of migration: if `value` is hidden and still legacy-plaintext (no
   * prefix), encrypts and returns it; otherwise returns it unchanged. Callers run this per
   * content column across every currently-hidden row after a successful `unlock()`. */
  migrateLegacyContent(value: string, isHidden: boolean): string {
    if (!isHidden || value.startsWith(CIPHER_PREFIX) || value === '') return value;
    return this.encrypt(value);
  }

  /** Decrypts with the old key and re-encrypts with the new one, for PIN-change rekeying.
   * Plaintext only ever exists in memory here, never written to disk mid-rekey. Values that
   * aren't in this scheme's format (empty, or legacy-plaintext not yet migrated) pass through
   * unchanged -- there's nothing keyed to rotate. */
  reencryptWithKeys(ciphertext: string, oldKey: Buffer, newKey: Buffer): string {
    if (!ciphertext.startsWith(CIPHER_PREFIX)) return ciphertext;
    return this.encryptWithKey(this.decryptWithKey(ciphertext, oldKey), newKey);
  }

  /** Throws if `currentPin` is wrong or `newPin` is out of range -- callers turn that into a
   * `{ ok: false, error }` response. Only persists the new hash/salts; rekeying hidden content
   * to the new key is the caller's job (main.ts's `security:setPin` handler), since it needs
   * the other services this class deliberately doesn't depend on. */
  validatePinChange(currentPin: string, newPin: string): void {
    if (!this.verifyPin(currentPin)) {
      throw new Error('Current PIN is incorrect');
    }
    if (!isValidPinLength(newPin)) {
      throw new Error(`PIN must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} characters`);
    }
  }

  persistNewPin(newPin: string): void {
    const { hash, salt } = hashPin(newPin);
    this.db
      .prepare(`UPDATE app_security SET pin_hash = ?, pin_salt = ?, key_salt = ? WHERE id = 1`)
      .run(hash, salt, generateSalt());
  }

  /** Swaps the cached key in place -- used after a successful PIN change so a session that
   * was already unlocked stays unlocked under the new PIN instead of being booted to locked. */
  setCachedKey(key: Buffer): void {
    this.cachedKey?.fill(0);
    this.cachedKey = key;
  }
}
