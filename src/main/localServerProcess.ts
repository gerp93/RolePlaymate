import { execFile } from 'node:child_process';
import * as path from 'path';

function run(file: string, args: string[], timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(typeof stdout === 'string' ? stdout : String(stdout));
      }
    );
  });
}

function runIgnore(file: string, args: string[], timeoutMs = 8_000): Promise<void> {
  return run(file, args, timeoutMs).then(
    () => undefined,
    () => undefined
  );
}

/** Port to hit if the URL has no explicit port. Null if the host is not loopback. */
export function loopbackPort(hostUrl: string, fallbackPort: number): number | null {
  try {
    const url = new URL(hostUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
      return null;
    }
    if (url.port) {
      const port = Number(url.port);
      return Number.isInteger(port) && port > 0 ? port : null;
    }
    return fallbackPort;
  } catch {
    return null;
  }
}

async function pidsListeningOnPort(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    const stdout = await run('netstat', ['-ano', '-p', 'TCP']).catch(() => '');
    const pids = new Set<number>();
    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4 || parts[0].toUpperCase() !== 'TCP') continue;
      if (parts[parts.length - 2]?.toUpperCase() !== 'LISTENING') continue;
      const address = parts[1] ?? '';
      const boundPort = Number(address.slice(address.lastIndexOf(':') + 1));
      const pid = Number(parts[parts.length - 1]);
      if (boundPort === port && Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }

  const stdout = await run('lsof', ['-iTCP:' + String(port), '-sTCP:LISTEN', '-t']).catch(() => '');
  return stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function pidsWithExecutableUnder(dir: string): Promise<number[]> {
  const root = path.resolve(dir);
  if (process.platform === 'win32') {
    const escaped = root.replace(/'/g, "''");
    const script = [
      `$root = '${escaped}'`,
      'Get-CimInstance Win32_Process |',
      '  Where-Object {',
      '    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or',
      '    ($_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0)',
      '  } |',
      '  Select-Object -ExpandProperty ProcessId',
    ].join(' ');
    const stdout = await run('powershell.exe', ['-NoProfile', '-Command', script], 15_000).catch(
      () => ''
    );
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }

  const stdout = await run('ps', ['-eo', 'pid=,command=']).catch(() => '');
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const pids: number[] = [];
  for (const line of stdout.split(/\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const command = match[2];
    if (command.startsWith(prefix) || command.startsWith(root + ' ')) {
      pids.push(Number(match[1]));
    }
  }
  return pids;
}

async function killPid(pid: number): Promise<void> {
  if (pid === process.pid || pid === process.ppid) return;
  if (process.platform === 'win32') {
    await runIgnore('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
}

export async function stopLocalServer(options: {
  hostUrl: string;
  fallbackPort: number;
  launchDir: string | null;
}): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const port = loopbackPort(options.hostUrl, options.fallbackPort);
  if (port == null) {
    return { status: 'error', message: 'Stop only works when the server is on this computer.' };
  }

  const pids = new Set<number>(await pidsListeningOnPort(port));
  if (options.launchDir) {
    for (const pid of await pidsWithExecutableUnder(options.launchDir)) pids.add(pid);
  }

  if (pids.size === 0) {
    return { status: 'error', message: "Couldn't find a process to stop." };
  }

  await Promise.all([...pids].map((pid) => killPid(pid)));
  return { status: 'ok' };
}
