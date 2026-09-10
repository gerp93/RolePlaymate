import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, dialog } from 'electron';
import { FIELD_LIMITS, assertMaxLength } from '../shared/fieldLimits';
import { ChatterboxClient, DEFAULT_CHATTERBOX_HOST } from './chat/chatterboxClient';
import { stopLocalServer } from './localServerProcess';
import {
  clearChatterboxLaunchDir,
  getChatterboxLaunchDir,
  setChatterboxLaunchDir,
} from './dbLocation';

/** True after a successful spawn this process. Chatterbox can take a while to listen;
 * this stops a second Start now / app-launch attempt from opening another instance. */
let launchedThisSession = false;

/** Flags that match a Windows portable + CUDA 12.8 Chatterbox install (Blackwell / cu128).
 * Harmless on an already-installed tree: start.py reuses the existing env and skips the menu. */
const WINDOWS_START_ARGS = ['--portable', '--nvidia-cu128', '--verbose'] as const;

function launcherInDir(dir: string): string | null {
  const bat = path.join(dir, 'start.bat');
  const py = path.join(dir, 'start.py');
  if (process.platform === 'win32' && fs.existsSync(bat)) return bat;
  if (fs.existsSync(py)) return py;
  if (fs.existsSync(bat)) return bat;
  return null;
}

function embeddedPython(dir: string): string | null {
  const exe = path.join(dir, 'python_embedded', process.platform === 'win32' ? 'python.exe' : 'python');
  return fs.existsSync(exe) ? exe : null;
}

export function assertChatterboxLaunchDir(dir: string): string {
  const trimmed = dir.trim();
  assertMaxLength(trimmed, FIELD_LIMITS.chatterboxLaunchDir, 'Chatterbox folder');
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) throw new Error('Chatterbox folder must be an absolute path.');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("That folder isn't on this computer.");
  }
  if (!launcherInDir(resolved)) {
    throw new Error("That folder doesn't look like Chatterbox TTS Server (no start.bat or start.py).");
  }
  return resolved;
}

function spawnDetached(command: string, args: string[], cwd: string): void {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.on('error', () => {
    launchedThisSession = false;
  });
  child.unref();
}

/** Windows: open a new console running the portable CUDA start line the install expects.
 * Elsewhere: python start.py (no GPU flags -- those are Windows portable-launcher options). */
async function launchChatterbox(resolved: string): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const py = path.join(resolved, 'start.py');
  if (!fs.existsSync(py)) {
    return { status: 'error', message: "That folder doesn't look like Chatterbox TTS Server." };
  }

  if (process.platform === 'win32') {
    const embedded = embeddedPython(resolved);
    // `start "title" /D dir cmd...` needs the title as the first quoted token.
    const inner = embedded
      ? `"${embedded}" start.py ${WINDOWS_START_ARGS.join(' ')}`
      : `start.bat ${WINDOWS_START_ARGS.join(' ')}`;
    spawnDetached(
      'cmd.exe',
      ['/c', 'start', 'Chatterbox TTS', '/D', resolved, 'cmd.exe', '/k', inner],
      resolved
    );
    return { status: 'ok' };
  }

  spawnDetached('python', ['start.py', '--verbose'], resolved);
  return { status: 'ok' };
}

export async function startChatterboxFromDir(dir: string): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (launchedThisSession) return { status: 'ok' };
  try {
    const resolved = assertChatterboxLaunchDir(dir);
    launchedThisSession = true;
    const result = await launchChatterbox(resolved);
    if (result.status === 'error') launchedThisSession = false;
    return result;
  } catch (error) {
    launchedThisSession = false;
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** If the user has pointed us at a Chatterbox folder and nothing is listening, start it.
 * Failures are silent -- spoken replies stay silent the same as a down server. */
export async function maybeStartChatterboxOnAppLaunch(client: ChatterboxClient): Promise<void> {
  const dir = getChatterboxLaunchDir();
  if (!dir || launchedThisSession) return;
  try {
    if (await client.isReachable()) return;
  } catch {
    // Treat as down and try to start.
  }
  await startChatterboxFromDir(dir);
}

export async function chooseChatterboxLaunchDir(
  window: BrowserWindow | null
): Promise<{ status: 'ok'; dir: string } | { status: 'cancelled' } | { status: 'error'; message: string }> {
  if (!window) return { status: 'error', message: 'No window to show the folder picker.' };
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose the Chatterbox TTS Server folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };
  try {
    const dir = assertChatterboxLaunchDir(result.filePaths[0]);
    setChatterboxLaunchDir(dir);
    return { status: 'ok', dir };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function stopChatterbox(
  client: ChatterboxClient
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (!(await client.isReachable())) {
    launchedThisSession = false;
    return { status: 'ok' };
  }
  const result = await stopLocalServer({
    hostUrl: client.host,
    fallbackPort: Number(new URL(DEFAULT_CHATTERBOX_HOST).port) || 8004,
    launchDir: getChatterboxLaunchDir(),
  });
  launchedThisSession = false;
  if (result.status === 'error') return result;
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (await client.isReachable()) {
    return { status: 'error', message: 'Chatterbox is still running.' };
  }
  return { status: 'ok' };
}

export function forgetChatterboxLaunchDir(): void {
  clearChatterboxLaunchDir();
}
