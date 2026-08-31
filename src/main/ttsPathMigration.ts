import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { getTtsDir } from './ttsAudio';

function normalizePath(filePath: string): string {
  const resolved = path.resolve(filePath.trim());
  return process.platform === 'win32' ? path.win32.normalize(resolved) : path.normalize(resolved);
}

function isUnderDir(filePath: string, dir: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedDir = normalizePath(dir);
  return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + path.sep);
}

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
 * Spoken-clip paths must live under the tts folder beside the active database.
 * Relocating the database copies that folder but leaves absolute paths on message
 * rows pointing at the old location -- rewrite them (and copy a leftover file in)
 * so Play and delete still hit the WAV that moved with the db.
 */
export function migrateTtsPathsToCanonicalDir(db: DatabaseSync): { updated: number; missing: number } {
  const canonicalDir = getTtsDir();
  fs.mkdirSync(canonicalDir, { recursive: true });

  let updated = 0;
  let missing = 0;

  for (const ref of collectTtsRefs(db)) {
    if (isUnderDir(ref.audioPath, canonicalDir)) continue;

    const fileName = path.basename(ref.audioPath);
    const canonicalPath = path.join(canonicalDir, fileName);

    if (fs.existsSync(canonicalPath)) {
      db.prepare(`UPDATE ${ref.table} SET tts_audio_path = ? WHERE id = ?`).run(canonicalPath, ref.id);
      updated++;
      continue;
    }

    if (fs.existsSync(ref.audioPath)) {
      fs.copyFileSync(ref.audioPath, canonicalPath);
      db.prepare(`UPDATE ${ref.table} SET tts_audio_path = ? WHERE id = ?`).run(canonicalPath, ref.id);
      updated++;
      continue;
    }

    missing++;
  }

  return { updated, missing };
}
