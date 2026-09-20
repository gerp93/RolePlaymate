import type { DatabaseSync } from './database/sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { getTtsDir, getTtsLibraryDirs } from './ttsAudio';
import { isUnderDir } from './dbLocation';
import { protectLibraryFile } from './fileCrypto';

interface TtsRef {
  table: 'messages' | 'message_variants';
  id: string;
  audioPath: string;
}

function collectTtsRefs(db: DatabaseSync): TtsRef[] {
  const refs: TtsRef[] = [];

  for (const table of ['messages', 'message_variants'] as const) {
    const rows = db
      .prepare(
        `SELECT id, tts_audio_path as path FROM ${table} WHERE tts_audio_path IS NOT NULL AND tts_audio_path != ''`
      )
      .all() as Array<{ id: string; path: string }>;
    for (const row of rows) {
      refs.push({ table, id: row.id, audioPath: row.path });
    }
  }

  return refs;
}

/**
 * Spoken-clip paths must live in one of the tts library folders: the one beside the active
 * database, or -- on the default location -- the pre-RolePlaymate_Data `userData/tts`, whose
 * clips are left exactly where they are. Relocating the database leaves absolute paths on
 * message rows pointing at the old location -- copy each referenced file in (the original is
 * never touched) and rewrite the row so Play and delete hit the copy that travels with the db.
 */
export function migrateTtsPathsToCanonicalDir(db: DatabaseSync): { updated: number; missing: number } {
  const canonicalDir = getTtsDir();
  const libraryDirs = getTtsLibraryDirs();
  fs.mkdirSync(canonicalDir, { recursive: true });

  let updated = 0;
  let missing = 0;

  for (const ref of collectTtsRefs(db)) {
    if (libraryDirs.some((dir) => isUnderDir(ref.audioPath, dir))) continue;

    const fileName = path.basename(ref.audioPath);
    const canonicalPath = path.join(canonicalDir, fileName);

    if (fs.existsSync(canonicalPath)) {
      db.prepare(`UPDATE ${ref.table} SET tts_audio_path = ? WHERE id = ?`).run(canonicalPath, ref.id);
      updated++;
      continue;
    }

    if (fs.existsSync(ref.audioPath)) {
      fs.copyFileSync(ref.audioPath, canonicalPath);
      protectLibraryFile(canonicalPath);
      db.prepare(`UPDATE ${ref.table} SET tts_audio_path = ? WHERE id = ?`).run(canonicalPath, ref.id);
      updated++;
      continue;
    }

    missing++;
  }

  return { updated, missing };
}
