import type { DatabaseSync } from './sqlite';
import { v4 as uuidv4 } from 'uuid';
import { Character, CreateCharacterInput, UpdateCharacterInput } from '../../shared/types/character';
import { parseTtsVoice } from '../../shared/types/tts';
import { transaction } from './schema';
import { SecurityService } from './securityService';

export class CharacterService {
  constructor(
    private db: DatabaseSync,
    private security: SecurityService
  ) {}

  /** Rows come back keyed by the SELECT_COLUMNS aliases, so this only has to fix up what SQL
   * can't express -- NULL vs undefined for the optional description. */
  private rowToCharacter(row: Record<string, unknown>): Character {
    const description = row.description as string | null;
    const ttsVoice = parseTtsVoice(
      ((row.ttsVoiceMode ?? row.tts_voice_mode) as string | null | undefined) ?? null,
      ((row.ttsVoiceId ?? row.tts_voice_id) as string | null | undefined) ?? null
    );
    return {
      id: row.id as string,
      name: row.name as string,
      description,
      ttsVoice,
      messageCount: Number(row.messageCount ?? 0),
      isHidden: !!row.isHidden,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }

  private readonly SELECT_COLUMNS = `
    id,
    name,
    description,
    tts_voice_mode as ttsVoiceMode,
    tts_voice_id as ttsVoiceId,
    message_count as messageCount,
    is_hidden as isHidden,
    created_at as createdAt,
    updated_at as updatedAt
  `;

  getAllCharacters(): Character[] {
    const rows = this.db
      .prepare(`SELECT ${this.SELECT_COLUMNS} FROM characters ORDER BY updated_at DESC`)
      .all();
    return rows.map((r) => this.rowToCharacter(r));
  }

  getCharacterById(id: string): Character | null {
    const row = this.db.prepare(`SELECT ${this.SELECT_COLUMNS} FROM characters WHERE id = ?`).get(id);
    return row ? this.rowToCharacter(row) : null;
  }

  /** New characters are never created hidden, so nothing here ever needs to encrypt. */
  createCharacter(input: CreateCharacterInput): Character {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO characters (id, name, image_url, description, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)`
      )
      .run(id, input.name, input.description ?? null, now, now);

    return this.getCharacterById(id)!;
  }

  updateCharacter(id: string, input: UpdateCharacterInput): Character {
    const existing = this.getCharacterById(id);
    if (!existing) {
      throw new Error(`Character with id ${id} not found`);
    }

    const name = input.name ?? existing.name;
    const description = input.description ?? existing.description;
    const ttsVoice = Object.prototype.hasOwnProperty.call(input, 'ttsVoice')
      ? (input.ttsVoice ?? null)
      : existing.ttsVoice;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE characters SET name = ?, description = ?, tts_voice_mode = ?, tts_voice_id = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        name,
        description,
        ttsVoice?.mode ?? null,
        ttsVoice?.id ?? null,
        now,
        id
      );

    return this.getCharacterById(id)!;
  }

  /**
   * Hiding is only a privacy screen -- it flips the flag and nothing else. It still requires
   * the PIN to be entered first, so a locked session can't quietly hide or reveal items.
   */
  setHidden(id: string, hidden: boolean): Character {
    const existing = this.getCharacterById(id);
    if (!existing) {
      throw new Error(`Character with id ${id} not found`);
    }
    if (!this.security.isUnlocked()) {
      throw new Error('Unlock with the PIN before hiding or unhiding an item');
    }

    this.db
      .prepare(`UPDATE characters SET is_hidden = ?, updated_at = ? WHERE id = ?`)
      .run(hidden ? 1 : 0, new Date().toISOString(), id);
    return this.getCharacterById(id)!;
  }

  /** Cascades to character_fields, character_field_versions, character_images, and scenarios
   * (and their own versions/images) via the schema's ON DELETE CASCADE constraints, which are
   * enforced now that foreign keys are on. Note this removes image *rows* but not the files on
   * disk -- callers that care fetch the paths before deleting and unlink them (see the
   * characters:delete IPC handler).
   *
   * conversations.character_id is ON DELETE SET NULL, not CASCADE -- left that way so a DDL
   * change alone can't silently start deleting chat history on existing databases. Instead,
   * delete this character's conversations explicitly first, in the same transaction; messages
   * and memories then cascade from the conversation delete. */
  deleteCharacter(id: string): void {
    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM conversations WHERE character_id = ?`).run(id);
      this.db.prepare(`DELETE FROM characters WHERE id = ?`).run(id);
    });
  }

  /** Drops clone-voice assignments that point at a clip just deleted from Chatterbox, so
   * pickers don't keep a "missing on server" ghost. Stock/predefined voices are untouched. */
  clearCloneVoice(filename: string): void {
    this.db
      .prepare(
        `UPDATE characters SET tts_voice_mode = NULL, tts_voice_id = NULL, updated_at = ?
         WHERE tts_voice_mode = 'clone' AND tts_voice_id = ?`
      )
      .run(new Date().toISOString(), filename);
  }
}
