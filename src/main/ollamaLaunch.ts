import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, dialog, shell } from 'electron';
import { FIELD_LIMITS, assertMaxLength } from '../shared/fieldLimits';
import { DEFAULT_OLLAMA_HOST, OllamaClient } from './chat/ollamaClient';
import { stopLocalServer } from './localServerProcess';
import {
  clearOllamaLaunchDir,
  getOllamaLaunchDir,
  setOllamaLaunchDir,
} from './dbLocation';

/** True after a successful spawn this process. Ollama can take a while to listen;
 * this stops a second Start now / app-launch attempt from opening another instance. */
let launchedThisSession = false;

function ollamaBinaryName(): string {
  return process.platform === 'win32' ? 'ollama.exe' : 'ollama';
}

function binaryInDir(dir: string): string | null {
  const binary = path.join(dir, ollamaBinaryName());
  if (!fs.existsSync(binary)) return null;
  try {
    if (!fs.statSync(binary).isFile()) return null;
  } catch {
    return null;
  }
  return binary;
}

export function assertOllamaLaunchDir(dir: string): string {
  const trimmed = dir.trim();
  assertMaxLength(trimmed, FIELD_LIMITS.ollamaLaunchDir, 'Ollama folder');
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) throw new Error('Ollama folder must be an absolute path.');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("That folder isn't on this computer.");
  }
  if (!binaryInDir(resolved)) {
    throw new Error(`That folder doesn't look like an Ollama install (no ${ollamaBinaryName()}).`);
  }
  return resolved;
}

export async function startOllamaFromDir(dir: string): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (launchedThisSession) return { status: 'ok' };
  try {
    const resolved = assertOllamaLaunchDir(dir);
    const binary = binaryInDir(resolved);
    if (!binary) {
      return { status: 'error', message: `That folder doesn't look like an Ollama install (no ${ollamaBinaryName()}).` };
    }
    launchedThisSession = true;
    if (process.platform === 'win32') {
      const err = await shell.openPath(binary);
      if (err) {
        launchedThisSession = false;
        return { status: 'error', message: err };
      }
      return { status: 'ok' };
    }
    const child = spawn(binary, ['serve'], {
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

/** If the user has pointed us at an Ollama folder and nothing is listening, start it.
 * Failures are silent -- chat still shows the usual unreachable banner. */
export async function maybeStartOllamaOnAppLaunch(client: OllamaClient): Promise<void> {
  const dir = getOllamaLaunchDir();
  if (!dir || launchedThisSession) return;
  try {
    if (await client.isReachable()) return;
  } catch {
    // Treat as down and try to start.
  }
  await startOllamaFromDir(dir);
}

export async function chooseOllamaLaunchDir(
  window: BrowserWindow | null
): Promise<{ status: 'ok'; dir: string } | { status: 'cancelled' } | { status: 'error'; message: string }> {
  if (!window) return { status: 'error', message: 'No window to show the folder picker.' };
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose the Ollama folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };
  try {
    const dir = assertOllamaLaunchDir(result.filePaths[0]);
    setOllamaLaunchDir(dir);
    return { status: 'ok', dir };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function stopOllama(
  client: OllamaClient
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (!(await client.isReachable())) {
    launchedThisSession = false;
    return { status: 'ok' };
  }
  const result = await stopLocalServer({
    hostUrl: client.host,
    fallbackPort: Number(new URL(DEFAULT_OLLAMA_HOST).port) || 11434,
    launchDir: getOllamaLaunchDir(),
  });
  launchedThisSession = false;
  if (result.status === 'error') return result;
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (await client.isReachable()) {
    return { status: 'error', message: 'Ollama is still running.' };
  }
  return { status: 'ok' };
}

export function forgetOllamaLaunchDir(): void {
  clearOllamaLaunchDir();
}
