import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, dialog, shell } from 'electron';
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

function launcherInDir(dir: string): string | null {
  const bat = path.join(dir, 'start.bat');
  const py = path.join(dir, 'start.py');
  if (process.platform === 'win32' && fs.existsSync(bat)) return bat;
  if (fs.existsSync(py)) return py;
  if (fs.existsSync(bat)) return bat;
  return null;
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

export async function startChatterboxFromDir(dir: string): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (launchedThisSession) return { status: 'ok' };
  try {
    const resolved = assertChatterboxLaunchDir(dir);
    const launcher = launcherInDir(resolved);
    if (!launcher) {
      return { status: 'error', message: "That folder doesn't look like Chatterbox TTS Server." };
    }
    launchedThisSession = true;
    if (/\.(bat|cmd)$/i.test(launcher)) {
      const err = await shell.openPath(launcher);
      if (err) {
        launchedThisSession = false;
        return { status: 'error', message: err };
      }
      return { status: 'ok' };
    }
    const child = spawn('python', [path.basename(launcher)], {
      cwd: resolved,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.on('error', () => {
      launchedThisSession = false;
    });
    child.unref();
    return { status: 'ok' };
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
