import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { DEFAULT_OLLAMA_HOST } from './chat/ollamaClient';

// Despite the filename (kept for the db-path exports below, the original reason this file
// exists), this is also the app's one general-purpose accessor for app-config.json -- the
// Ollama host override lives in the same file for the same reason the db path does: a small,
// user-editable setting that isn't worth its own config file or a database row.
interface AppConfig {
  dbPath?: string;
  ollamaHost?: string;
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

export function getDefaultDbPath(): string {
  return path.join(app.getPath('userData'), 'roleplaymate.db');
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
  const currentPath = getEffectiveDbPath();

  if (!fs.existsSync(newPath) && fs.existsSync(currentPath)) {
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.copyFileSync(currentPath, newPath);
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

/** The Ollama server URL the app will actually call: a user-configured one, or the
 * localhost:11434 default. Read fresh on every call (via OllamaClient's hostProvider) rather
 * than cached, so a change here takes effect on the next request with no restart needed. */
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
