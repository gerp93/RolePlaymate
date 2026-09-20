import type { DatabaseSync } from './sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 20;

/** scrypt is a Node built-in (no bcrypt dependency) and deliberately slow, so the stored hash
 * of a short PIN still can't be brute-forced instantly. */
export function hashPin(pin: string): { hash: Buffer; salt: Buffer } {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64);
  return { hash, salt };
}

function isValidPinLength(pin: string): boolean {
  return pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;
}

/**
 * The Hidden Items PIN: a privacy screen, nothing more. Items the user marks hidden stay out of
 * every list until the PIN is entered, but their data is stored exactly like everything else --
 * whether it is encrypted on disk is the separate, app-wide encryption setting (see
 * appEncryption.ts), and the two have independent secrets.
 *
 * "Unlocked" is in-memory only and resets on every launch, so the app always opens with hidden
 * items hidden. It gates what the main process returns (hidden rows are filtered out of
 * responses while locked), not just what the renderer draws.
 */
export class SecurityService {
  private unlocked = false;

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

  /** Returns false (rather than throwing) on a wrong PIN, since that's an expected outcome. */
  unlock(pin: string): boolean {
    if (!this.verifyPin(pin)) return false;
    this.unlocked = true;
    return true;
  }

  lock(): void {
    this.unlocked = false;
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Throws if `currentPin` is wrong or `newPin` is out of range -- callers turn that into a
   * `{ ok: false, error }` response. Only the verification hash changes; nothing is encrypted
   * under this PIN any more, so there is nothing to rekey. */
  changePin(currentPin: string, newPin: string): void {
    if (!this.verifyPin(currentPin)) {
      throw new Error('Current PIN is incorrect');
    }
    if (!isValidPinLength(newPin)) {
      throw new Error(`PIN must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} characters`);
    }
    const { hash, salt } = hashPin(newPin);
    this.db.prepare(`UPDATE app_security SET pin_hash = ?, pin_salt = ? WHERE id = 1`).run(hash, salt);
  }
}
