import * as path from 'path';
import * as fs from 'fs';
import { app, shell, dialog } from 'electron';
import { DEFAULT_OLLAMA_HOST } from './chat/ollamaClient';
import { DEFAULT_EMBEDDING_MODEL } from '../shared/embeddingModel';

// Despite the filename (kept for the db-path exports below, the original reason this file
// exists), this is also the app's one general-purpose accessor for app-config.json -- the
// Ollama host override lives in the same file for the same reason the db path does: a small,
// user-editable setting that isn't worth its own config file or a database row.
interface AppConfig {
  dbPath?: string;
  ollamaHost?: string;
  /** webContents zoom level; 0 is default. Persisted across sessions. */
  zoomLevel?: number;
  /** When true, Chat no longer prompts to install the memory embedding model. */
  suppressEmbeddingModelPrompt?: boolean;
  /** Ollama model name used for semantic memory retrieval. Falls back to the app default when unset. */
  memoryEmbeddingModel?: string;
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function readConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config: AppConfig): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

function readConfigAt(configPath: string): AppConfig {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function normalizeDbPath(filePath: string): string {
  const resolved = path.resolve(filePath.trim());
  return process.platform === 'win32' ? path.win32.normalize(resolved) : path.normalize(resolved);
}

export function getPackagedAppConfigPath(): string {
  return path.join(app.getPath('appData'), 'roleplaymate', 'app-config.json');
}

/** Where the installed app would open its database -- used to keep dev from sharing it. */
export function getPackagedConfiguredDbPath(): string | null {
  if (app.isPackaged) return null;
  const packagedConfig = readConfigAt(getPackagedAppConfigPath());
  if (packagedConfig.dbPath?.trim()) {
    return normalizeDbPath(packagedConfig.dbPath);
  }
  return normalizeDbPath(path.join(app.getPath('appData'), 'roleplaymate', 'roleplaymate.db'));
}

export function isPackagedDatabasePath(dbPath: string): boolean {
  const packagedPath = getPackagedConfiguredDbPath();
  return packagedPath !== null && normalizeDbPath(dbPath) === packagedPath;
}

/** Dev must not open the packaged app's database. Reset to the dev default if it does. */
export function enforceDevDatabaseIsolation(): boolean {
  if (app.isPackaged || !isPackagedDatabasePath(getEffectiveDbPath())) return false;

  resetToDefaultDbPath();
  dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Dev database reset',
    message: 'Dev was pointed at the packaged app database.',
    detail:
      `Dev now uses its isolated default:\n${getDefaultDbPath()}\n\n` +
      'Use Settings to choose a dev-only database on a different drive.',
    buttons: ['OK'],
  });
  return true;
}

export function getDefaultDbPath(): string {
  return path.join(app.getPath('userData'), 'roleplaymate.db');
}

function copyImagesBesideDatabase(fromDbPath: string, toDbPath: string): void {
  const fromImages = path.join(path.dirname(fromDbPath), 'images');
  const toImages = path.join(path.dirname(toDbPath), 'images');
  if (!fs.existsSync(fromImages) || fs.existsSync(toImages)) return;
  fs.cpSync(fromImages, toImages, { recursive: true });
}

/** The database file the app will actually load on startup: a user-chosen location, or the default. */
export function getEffectiveDbPath(): string {
  const configured = readConfig().dbPath;
  return configured && configured.trim() !== '' ? configured : getDefaultDbPath();
}

export function isUsingDefaultLocation(): boolean {
  return !readConfig().dbPath;
}

/**
 * Point the app at a different SQLite file. If nothing exists yet at the new
 * location, the current database is copied there first so no data is lost.
 * If a file already exists there, it's left alone and simply adopted as-is.
 *
 * PRECONDITION: the database must already be closed (see closeDatabase). The app runs in
 * WAL mode, so recently committed data can live in the `-wal` sidecar rather than the main
 * file -- copying while open would silently drop it. A clean close() checkpoints the WAL
 * into the main file and deletes the sidecars, which is what makes the plain copy below safe.
 */
export function setDbPath(newPath: string): void {
  if (!app.isPackaged && isPackagedDatabasePath(newPath)) {
    throw new Error('Dev cannot use the packaged app database. Choose a different file.');
  }

  const currentPath = getEffectiveDbPath();

  if (!fs.existsSync(newPath) && fs.existsSync(currentPath)) {
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.copyFileSync(currentPath, newPath);
    copyImagesBesideDatabase(currentPath, newPath);
    // Defensive: a stale sidecar left beside the destination by some earlier crash would be
    // replayed against our freshly copied file and corrupt it. The copy is already complete
    // on its own, so anything sitting there is garbage.
    fs.rmSync(`${newPath}-wal`, { force: true });
    fs.rmSync(`${newPath}-shm`, { force: true });
  }

  writeConfig({ ...readConfig(), dbPath: newPath });
}

export function resetToDefaultDbPath(): void {
  const config = readConfig();
  delete config.dbPath;
  writeConfig(config);
}

/** Open the system file manager at the database file, or its parent folder if missing. */
export async function revealDbInFileManager(): Promise<void> {
  const dbPath = normalizeDbPath(getEffectiveDbPath());

  if (fs.existsSync(dbPath)) {
    shell.showItemInFolder(dbPath);
    return;
  }

  const dir = normalizeDbPath(path.dirname(dbPath));
  if (!fs.existsSync(dir)) {
    throw new Error(`Database folder not found: ${dir}`);
  }
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
}

export function getEffectiveOllamaHost(): string {
  const configured = readConfig().ollamaHost;
  return configured && configured.trim() !== '' ? configured.trim() : DEFAULT_OLLAMA_HOST;
}

export function isUsingDefaultOllamaHost(): boolean {
  return !readConfig().ollamaHost;
}

/** Points the app at a different Ollama server -- a different port on the same machine, or a
 * server running on another machine entirely (a remote GPU box, WSL, ...). No validation that
 * anything is actually listening there; the usual "Ollama isn't reachable" banner covers that
 * the same way it already does for the default host. */
export function setOllamaHost(host: string): void {
  writeConfig({ ...readConfig(), ollamaHost: host.trim() });
}

export function resetOllamaHost(): void {
  const config = readConfig();
  delete config.ollamaHost;
  writeConfig(config);
}

const MIN_ZOOM_LEVEL = -5;
const MAX_ZOOM_LEVEL = 5;

function clampZoomLevel(level: number): number {
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, Math.round(level)));
}

export function getStoredZoomLevel(): number {
  const level = readConfig().zoomLevel;
  return typeof level === 'number' && Number.isFinite(level) ? clampZoomLevel(level) : 0;
}

export function setStoredZoomLevel(level: number): void {
  const clamped = clampZoomLevel(level);
  const config = readConfig();
  if (clamped === 0) {
    delete config.zoomLevel;
  } else {
    config.zoomLevel = clamped;
  }
  writeConfig(config);
}

export function isEmbeddingModelPromptSuppressed(): boolean {
  return readConfig().suppressEmbeddingModelPrompt === true;
}

export function setEmbeddingModelPromptSuppressed(suppressed: boolean): void {
  const config = readConfig();
  if (suppressed) {
    config.suppressEmbeddingModelPrompt = true;
  } else {
    delete config.suppressEmbeddingModelPrompt;
  }
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeConfig(config);
}

export function getConfiguredMemoryEmbeddingModel(): string {
  const configured = readConfig().memoryEmbeddingModel?.trim();
  return configured || DEFAULT_EMBEDDING_MODEL;
}

export function isUsingDefaultMemoryEmbeddingModel(): boolean {
  return !readConfig().memoryEmbeddingModel?.trim();
}

export function setConfiguredMemoryEmbeddingModel(model: string): void {
  const trimmed = model.trim();
  if (!trimmed) throw new Error('Embedding model name is required');
  const config = readConfig();
  if (trimmed === DEFAULT_EMBEDDING_MODEL) {
    delete config.memoryEmbeddingModel;
  } else {
    config.memoryEmbeddingModel = trimmed;
  }
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeConfig(config);
}

export function resetMemoryEmbeddingModel(): void {
  const config = readConfig();
  delete config.memoryEmbeddingModel;
  writeConfig(config);
}
