import * as path from 'path';
import * as fs from 'fs';
import { app, shell, dialog } from 'electron';
import { DEFAULT_OLLAMA_HOST } from './chat/ollamaClient';
import { DEFAULT_CHATTERBOX_HOST } from './chat/chatterboxClient';
import { DEFAULT_EMBEDDING_MODEL } from '../shared/embeddingModel';
import { CharacterTtsVoice } from '../shared/types/tts';
import {
  ChatRetentionRule,
  ChatRetentionState,
  parseRetentionRules,
} from '../shared/retention';

// Despite the filename (kept for the db-path exports below, the original reason this file
// exists), this is also the app's one general-purpose accessor for app-config.json -- the
// Ollama and Chatterbox host overrides live in the same file for the same reason the db path
// does: a small, user-editable setting that isn't worth its own config file or a database row.
interface AppConfig {
  dbPath?: string;
  ollamaHost?: string;
  chatterboxHost?: string;
  /** Folder that contains ollama.exe / ollama. RolePlaymate starts it on launch if the server is down. */
  ollamaLaunchDir?: string;
  /** Folder that contains Chatterbox's start.bat / start.py. RolePlaymate starts it on launch if the server is down. */
  chatterboxLaunchDir?: string;
  /** Fallback TTS voice when a character has none. Same shape as Character.ttsVoice. */
  narratorVoice?: CharacterTtsVoice;
  /** Friendly names for Chatterbox clone clips, keyed by filename. */
  cloneVoiceNames?: Record<string, string>;
  /** webContents zoom level; 0 is default. Persisted across sessions. */
  zoomLevel?: number;
  /** When true, Chat no longer prompts to install the memory embedding model. */
  suppressEmbeddingModelPrompt?: boolean;
  /** Ollama model name used for semantic memory retrieval. Falls back to the app default when unset. */
  memoryEmbeddingModel?: string;
  /** 0–N chat deletion rules. Missing or empty means keep forever. */
  chatRetentionRules?: unknown;
  chatRetentionLastRunAt?: string;
  chatRetentionLastDeletedCount?: number;
  /** When true, an extra prompt instruction nudges replies toward shorter, more conversational
   * turns. Global rather than per-conversation on purpose -- toggled live from Chat Settings so
   * the same conversation can be A/B tested against itself without an app restart. */
  conciseReplies?: boolean;
  /** Narration point-of-view nudge for character replies. Unset leaves the model's own default
   * alone. Global for the same reason conciseReplies is. */
  narrationPov?: 'first' | 'third';
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function readConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    // Strip a UTF-8 BOM if present -- PowerShell Set-Content -Encoding UTF8 writes one,
    // and JSON.parse then throws, which used to silently fall back to an empty default DB.
    return JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
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
    return JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
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

// The db always lives inside its own app-named subfolder, both at the default install location
// and anywhere it's relocated to -- never as a bare file whose generic `images`/`tts` siblings
// would land directly in a shared parent folder and silently mix with another app's
// identically-named folders (two apps' databases relocated into one synced "databases" folder).
// Suffixed `_Data` rather than plain `RolePlaymate` because at the default location this nests
// inside userData, which Electron already names after the app (`app.setName('roleplaymate')`),
// and `roleplaymate/RolePlaymate/` would be a redundant same-named parent/child pair.
export const DB_SUBFOLDER = 'RolePlaymate_Data';
const DB_FILENAME = 'roleplaymate.db';

/** Where the installed app would open its database -- used to keep dev from sharing it. */
export function getPackagedConfiguredDbPath(): string | null {
  if (app.isPackaged) return null;
  const packagedConfig = readConfigAt(getPackagedAppConfigPath());
  if (packagedConfig.dbPath?.trim()) {
    return normalizeDbPath(packagedConfig.dbPath);
  }
  return normalizeDbPath(path.join(app.getPath('appData'), 'roleplaymate', DB_SUBFOLDER, DB_FILENAME));
}

export function isPackagedDatabasePath(dbPath: string): boolean {
  const packagedPath = getPackagedConfiguredDbPath();
  if (packagedPath === null) return false;
  const candidate = normalizeDbPath(dbPath);
  if (candidate === packagedPath) return true;
  // Until the installed app has run once and migrated, its default database is still the old
  // flat file -- dev must not adopt that one either.
  const packagedLegacyPath = normalizeDbPath(path.join(app.getPath('appData'), 'roleplaymate', DB_FILENAME));
  return candidate === packagedLegacyPath;
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
  return path.join(app.getPath('userData'), DB_SUBFOLDER, DB_FILENAME);
}

/** Where the db file lives when relocated into the given parent folder -- always nested under
 * DB_SUBFOLDER, same as the default location, so the structure is guaranteed by construction
 * rather than depending on the user organising a subfolder themselves. */
export function dbPathInsideFolder(parentFolder: string): string {
  return path.join(parentFolder, DB_SUBFOLDER, DB_FILENAME);
}

/** Before DB_SUBFOLDER existed the default database was a bare file in userData. */
function getLegacyDefaultDbPath(): string {
  return path.join(app.getPath('userData'), DB_FILENAME);
}

/**
 * One-time upgrade for installs still on the old flat default (`userData/roleplaymate.db`):
 * moves the database and its WAL/SHM sidecars into `userData/RolePlaymate_Data/`. Must run
 * before anything opens a connection.
 *
 * Nothing here can lose data:
 * - Only renames, never copy-then-delete, so a file is at exactly one of the two locations at
 *   every instant. A rename within one folder tree is atomic.
 * - It refuses to overwrite: if the nested database already exists, or any destination file
 *   does, it leaves everything where it is (see the two guards below).
 * - The sidecars move BEFORE the main file, so an interrupted run leaves the database at its
 *   old path (still the trigger for re-running this) with, at worst, its WAL already beside
 *   where it is going -- which is where SQLite will look for it once the database follows.
 *   The other order could strand a WAL holding committed pages with no database to apply to.
 * - On any failure the renames already made are undone, then the error propagates so startup
 *   stops with a dialog instead of opening a new, empty database at the nested path.
 *
 * Existing portraits and spoken clips are deliberately NOT moved: their rows store absolute
 * paths that keep working where they are (see getLegacyLibraryDir); only new files land in the
 * nested folder.
 */
export function migrateLegacyDefaultDbLocation(): void {
  const legacyPath = getLegacyDefaultDbPath();
  const configured = readConfig().dbPath?.trim();
  // A config that explicitly names the flat default file (e.g. "Use Existing File…" pointed at
  // it) is the same install and gets the same migration; the override is dropped once it's moved.
  const pointsAtLegacy = !!configured && normalizeDbPath(configured) === normalizeDbPath(legacyPath);
  if (!isUsingDefaultLocation() && !pointsAtLegacy) return;
  if (!fs.existsSync(legacyPath)) return;

  const newPath = getDefaultDbPath();
  if (fs.existsSync(newPath)) {
    // Both exist -- e.g. an older build was run after upgrading and made a fresh flat database.
    // Which one is "real" isn't something to guess at; leave both alone.
    console.warn(
      `Not migrating ${legacyPath}: ${newPath} already exists. Both files were left untouched.`
    );
    return;
  }

  const moves = ['-wal', '-shm', ''].map((suffix) => ({
    from: legacyPath + suffix,
    to: newPath + suffix,
  }));
  const pending = moves.filter((move) => fs.existsSync(move.from));
  const blocked = pending.find((move) => fs.existsSync(move.to));
  if (blocked) {
    throw new Error(
      `Can't move the database into ${path.dirname(newPath)}: ${blocked.to} already exists. ` +
        'Nothing was changed.'
    );
  }

  if (pointsAtLegacy) {
    // Before the moves: if we crash in between, the next launch is a plain default-location
    // migration rather than an override pointing at a file that is no longer there.
    const config = readConfig();
    delete config.dbPath;
    writeConfig(config);
  }

  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  const done: typeof moves = [];
  try {
    for (const move of pending) {
      fs.renameSync(move.from, move.to);
      done.push(move);
    }
  } catch (error) {
    for (const move of done.reverse()) {
      try {
        fs.renameSync(move.to, move.from);
      } catch {
        // Best effort. The next launch's guards see the remaining state and fail loudly.
      }
    }
    throw error;
  }
}

/**
 * Portraits and spoken clips that older versions wrote to `userData/images` and `userData/tts`
 * (siblings of the flat default database). Their rows keep pointing there, so those folders
 * stay part of the library alongside the nested ones: served, encrypted/decrypted, and
 * deletable exactly like the current folders. Only meaningful while on the default location --
 * a relocated install has its own folders, which the path migrations fold into the new
 * location one referenced file at a time. Null when there is nothing to include.
 */
export function getLegacyLibraryDir(name: 'images' | 'tts'): string | null {
  if (!isUsingDefaultLocation()) return null;
  const dir = path.join(app.getPath('userData'), name);
  return fs.existsSync(dir) ? dir : null;
}

/** True when `filePath` is `dir` itself or anywhere beneath it. */
export function isUnderDir(filePath: string, dir: string): boolean {
  const normalizedPath = normalizeDbPath(filePath);
  const normalizedDir = normalizeDbPath(dir);
  return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + path.sep);
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
    // The portraits and clips are NOT copied here as whole folders: the old folder can hold
    // another app's files (that is the collision this layout exists to prevent), and copying it
    // would carry them into the new one. The path migrations run at the next launch instead and
    // copy exactly the files this database's rows reference, from wherever those rows point.
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

export function getEffectiveChatterboxHost(): string {
  const configured = readConfig().chatterboxHost;
  return configured && configured.trim() !== '' ? configured.trim() : DEFAULT_CHATTERBOX_HOST;
}

export function isUsingDefaultChatterboxHost(): boolean {
  return !readConfig().chatterboxHost;
}

/** Points the app at a different Chatterbox TTS server -- a different port, or a box on the
 * LAN. No validation that anything is listening; spoken replies stay silent when it isn't. */
export function setChatterboxHost(host: string): void {
  writeConfig({ ...readConfig(), chatterboxHost: host.trim() });
}

export function resetChatterboxHost(): void {
  const config = readConfig();
  delete config.chatterboxHost;
  writeConfig(config);
}

export function getOllamaLaunchDir(): string | null {
  const dir = readConfig().ollamaLaunchDir?.trim();
  return dir || null;
}

export function setOllamaLaunchDir(dir: string): void {
  writeConfig({ ...readConfig(), ollamaLaunchDir: dir });
}

export function clearOllamaLaunchDir(): void {
  const config = readConfig();
  delete config.ollamaLaunchDir;
  writeConfig(config);
}

export function getChatterboxLaunchDir(): string | null {
  const dir = readConfig().chatterboxLaunchDir?.trim();
  return dir || null;
}

export function setChatterboxLaunchDir(dir: string): void {
  writeConfig({ ...readConfig(), chatterboxLaunchDir: dir });
}

export function clearChatterboxLaunchDir(): void {
  const config = readConfig();
  delete config.chatterboxLaunchDir;
  writeConfig(config);
}

function parseStoredNarratorVoice(raw: unknown): CharacterTtsVoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { mode?: unknown; id?: unknown };
  if ((row.mode !== 'predefined' && row.mode !== 'clone') || typeof row.id !== 'string') return null;
  const id = row.id.trim();
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) return null;
  return { mode: row.mode, id };
}

export function getNarratorVoice(): CharacterTtsVoice | null {
  return parseStoredNarratorVoice(readConfig().narratorVoice);
}

export function setNarratorVoice(voice: CharacterTtsVoice | null): void {
  const config = readConfig();
  if (!voice) {
    delete config.narratorVoice;
  } else {
    config.narratorVoice = { mode: voice.mode, id: voice.id };
  }
  writeConfig(config);
}

export function getConciseReplies(): boolean {
  return readConfig().conciseReplies === true;
}

export function setConciseReplies(value: boolean): void {
  const config = readConfig();
  if (value) {
    config.conciseReplies = true;
  } else {
    delete config.conciseReplies;
  }
  writeConfig(config);
}

export function getNarrationPov(): 'first' | 'third' | null {
  const raw = readConfig().narrationPov;
  return raw === 'first' || raw === 'third' ? raw : null;
}

export function setNarrationPov(value: 'first' | 'third' | null): void {
  const config = readConfig();
  if (value === 'first' || value === 'third') {
    config.narrationPov = value;
  } else {
    delete config.narrationPov;
  }
  writeConfig(config);
}

export function getCloneVoiceNames(): Record<string, string> {
  const raw = readConfig().cloneVoiceNames;
  if (!raw || typeof raw !== 'object') return {};
  const names: Record<string, string> = {};
  for (const [filename, name] of Object.entries(raw)) {
    if (typeof name === 'string' && name.trim()) names[filename] = name.trim();
  }
  return names;
}

export function setCloneVoiceName(filename: string, displayName: string): void {
  const trimmed = displayName.trim();
  if (!trimmed) return;
  const config = readConfig();
  config.cloneVoiceNames = { ...getCloneVoiceNames(), [filename]: trimmed };
  writeConfig(config);
}

export function removeCloneVoiceName(filename: string): void {
  const names = getCloneVoiceNames();
  if (!(filename in names)) return;
  delete names[filename];
  const config = readConfig();
  if (Object.keys(names).length === 0) delete config.cloneVoiceNames;
  else config.cloneVoiceNames = names;
  writeConfig(config);
}

export function getChatRetentionState(): ChatRetentionState {
  const config = readConfig() as AppConfig & { chatRetentionAutoRun?: boolean };
  let rules = parseRetentionRules(config.chatRetentionRules);
  // One-shot: the schedule used to be a global flag. Copy it onto each rule, then drop it.
  if (config.chatRetentionAutoRun === true && rules.some((rule) => !rule.autoRun)) {
    rules = rules.map((rule) => ({ ...rule, autoRun: true }));
    config.chatRetentionRules = rules;
  }
  if ('chatRetentionAutoRun' in config) {
    delete config.chatRetentionAutoRun;
    writeConfig(config);
  }
  const lastDeleted = config.chatRetentionLastDeletedCount;
  return {
    rules,
    lastRunAt: typeof config.chatRetentionLastRunAt === 'string' ? config.chatRetentionLastRunAt : null,
    lastDeletedCount: typeof lastDeleted === 'number' && Number.isFinite(lastDeleted) ? lastDeleted : 0,
  };
}

export function setChatRetentionRules(rules: unknown): ChatRetentionRule[] {
  const parsed = parseRetentionRules(rules);
  const config = readConfig() as AppConfig & { chatRetentionAutoRun?: boolean };
  if (parsed.length === 0) delete config.chatRetentionRules;
  else config.chatRetentionRules = parsed;
  delete config.chatRetentionAutoRun;
  writeConfig(config);
  return parsed;
}

export function recordChatRetentionRun(deletedCount: number): void {
  const config = readConfig();
  config.chatRetentionLastRunAt = new Date().toISOString();
  config.chatRetentionLastDeletedCount = deletedCount;
  writeConfig(config);
}
