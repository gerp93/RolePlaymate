import { DatabaseSync } from 'node:sqlite';
import { StopPhraseSettings } from '../../shared/types/promptTemplates';

/** Only the stop-phrase settings live here now -- the 7 system-prompt templates get full
 * version history instead (see promptFieldVersionService.ts). Every column is nullable and
 * NULL means "use the default from promptTemplates.ts". See schema.ts for the `prompt_settings`
 * table (a single row, id = 1). */
export type ResettableField = 'stopPhrasesBase' | 'useCharacterNameAsStop' | 'usePersonaNameAsStop';

interface PromptSettingsRow {
  stopPhrasesBase: string | null;
  useCharacterNameAsStop: number | null;
  usePersonaNameAsStop: number | null;
}

const SELECT_COLUMNS = `
  stop_phrases_base as stopPhrasesBase,
  use_character_name_as_stop as useCharacterNameAsStop,
  use_persona_name_as_stop as usePersonaNameAsStop
`;

export class PromptSettingsService {
  constructor(private db: DatabaseSync) {}

  private getRow(): PromptSettingsRow {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM prompt_settings WHERE id = 1`).get() as
      | PromptSettingsRow
      | undefined;
    return row ?? { stopPhrasesBase: null, useCharacterNameAsStop: null, usePersonaNameAsStop: null };
  }

  /** Only the fields that are actually overridden -- callers merge this over the defaults. */
  getOverrides(): { stopPhrases: Partial<StopPhraseSettings> } {
    const row = this.getRow();
    const stopPhrases: Partial<StopPhraseSettings> = {};
    if (row.stopPhrasesBase != null) {
      try {
        stopPhrases.base = JSON.parse(row.stopPhrasesBase);
      } catch {
        // Corrupt/hand-edited value -- fall back to the default rather than crash a chat turn.
      }
    }
    if (row.useCharacterNameAsStop != null) stopPhrases.useCharacterNameAsStop = !!row.useCharacterNameAsStop;
    if (row.usePersonaNameAsStop != null) stopPhrases.usePersonaNameAsStop = !!row.usePersonaNameAsStop;

    return { stopPhrases };
  }

  private ensureRow(): void {
    this.db.prepare(`INSERT OR IGNORE INTO prompt_settings (id) VALUES (1)`).run();
  }

  updateStopPhrases(partial: Partial<StopPhraseSettings>): void {
    this.ensureRow();
    if (partial.base !== undefined) {
      this.db
        .prepare(`UPDATE prompt_settings SET stop_phrases_base = ? WHERE id = 1`)
        .run(JSON.stringify(partial.base));
    }
    if (partial.useCharacterNameAsStop !== undefined) {
      this.db
        .prepare(`UPDATE prompt_settings SET use_character_name_as_stop = ? WHERE id = 1`)
        .run(partial.useCharacterNameAsStop ? 1 : 0);
    }
    if (partial.usePersonaNameAsStop !== undefined) {
      this.db
        .prepare(`UPDATE prompt_settings SET use_persona_name_as_stop = ? WHERE id = 1`)
        .run(partial.usePersonaNameAsStop ? 1 : 0);
    }
  }

  resetField(field: ResettableField): void {
    this.ensureRow();
    const column =
      field === 'stopPhrasesBase'
        ? 'stop_phrases_base'
        : field === 'useCharacterNameAsStop'
          ? 'use_character_name_as_stop'
          : 'use_persona_name_as_stop';
    this.db.prepare(`UPDATE prompt_settings SET ${column} = NULL WHERE id = 1`).run();
  }

  resetAll(): void {
    this.ensureRow();
    this.db
      .prepare(
        `UPDATE prompt_settings SET
           stop_phrases_base = NULL, use_character_name_as_stop = NULL, use_persona_name_as_stop = NULL
         WHERE id = 1`
      )
      .run();
  }
}
