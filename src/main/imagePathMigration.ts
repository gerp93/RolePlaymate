import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getImagesDir } from './images';

function normalizePath(filePath: string): string {
  const resolved = path.resolve(filePath.trim());
  return process.platform === 'win32' ? path.win32.normalize(resolved) : path.normalize(resolved);
}

function isUnderDir(filePath: string, dir: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedDir = normalizePath(dir);
  return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + path.sep);
}

/** Old layout: portraits lived under packaged userData even when the db lived elsewhere. */
function getPackagedLegacyImagesDir(): string {
  return path.join(app.getPath('appData'), 'roleplaymate', 'images');
}

/** Dev never imports from the packaged app. Packaged may lift files out of the old userData folder once. */
function getAllowedImportSources(): string[] {
  if (!app.isPackaged) return [];
  return [getPackagedLegacyImagesDir()];
}

interface ImageRef {
  table: 'character_images' | 'persona_images' | 'scenario_images' | 'lorebooks';
  pathColumn: 'path' | 'image';
  id: string;
  imagePath: string;
}

function collectImageRefs(db: DatabaseSync): ImageRef[] {
  const refs: ImageRef[] = [];

  for (const table of ['character_images', 'persona_images', 'scenario_images'] as const) {
    const rows = db
      .prepare(`SELECT id, path FROM ${table} WHERE path IS NOT NULL AND path != ''`)
      .all() as Array<{ id: string; path: string }>;
    for (const row of rows) {
      refs.push({ table, pathColumn: 'path', id: row.id, imagePath: row.path });
    }
  }

  const lorebooks = db
    .prepare(`SELECT id, image FROM lorebooks WHERE image IS NOT NULL AND image != ''`)
    .all() as Array<{ id: string; image: string }>;
  for (const row of lorebooks) {
    refs.push({ table: 'lorebooks', pathColumn: 'image', id: row.id, imagePath: row.image });
  }

  return refs;
}

function updateImagePath(db: DatabaseSync, ref: ImageRef, canonicalPath: string): void {
  db.prepare(`UPDATE ${ref.table} SET ${ref.pathColumn} = ? WHERE id = ?`).run(canonicalPath, ref.id);
}

/**
 * Every portrait path must live under the images folder beside the active database.
 * Rewrites stale absolute paths and, in the packaged app only, may copy files out of the
 * legacy userData/images layout into the db-adjacent folder.
 */
export function migrateImagePathsToCanonicalDir(db: DatabaseSync): { updated: number; missing: number } {
  const canonicalDir = getImagesDir();
  fs.mkdirSync(canonicalDir, { recursive: true });
  const importSources = getAllowedImportSources();

  let updated = 0;
  let missing = 0;

  for (const ref of collectImageRefs(db)) {
    if (isUnderDir(ref.imagePath, canonicalDir)) continue;

    const fileName = path.basename(ref.imagePath);
    const canonicalPath = path.join(canonicalDir, fileName);

    if (fs.existsSync(canonicalPath)) {
      updateImagePath(db, ref, canonicalPath);
      updated++;
      continue;
    }

    const candidates = [
      ref.imagePath,
      ...importSources.map((sourceDir) => path.join(sourceDir, fileName)),
    ];

    let copied = false;
    for (const candidate of candidates) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      if (!app.isPackaged && isUnderDir(candidate, getPackagedLegacyImagesDir())) continue;

      fs.copyFileSync(candidate, canonicalPath);
      updateImagePath(db, ref, canonicalPath);
      updated++;
      copied = true;
      break;
    }

    if (!copied) missing++;
  }

  return { updated, missing };
}
