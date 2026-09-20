import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

export interface PromptOptions {
  heading: string;
  body: string;
  placeholder: string;
  submitLabel: string;
  /** Label for the button that gives up. */
  cancelLabel: string;
  wrongMessage: string;
}

const LAUNCH_OPTIONS: PromptOptions = {
  heading: 'Unlock RolePlaymate',
  body: 'Your library is encrypted. Enter your password to open it.',
  placeholder: 'Password',
  submitLabel: 'Unlock',
  cancelLabel: 'Quit',
  wrongMessage: 'Incorrect password.',
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(o: PromptOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${escapeHtml(o.heading)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f5f5f5; --fg:#1c1c1e; --muted:#6b6b70; --card:#fff; --line:#d4d4d8; --accent:#4f46e5; --err:#c62828; }
  @media (prefers-color-scheme: dark) { :root { --bg:#17171a; --fg:#ececf0; --muted:#9a9aa3; --card:#222227; --line:#3a3a42; --accent:#8b83ff; --err:#ef7a7a; } }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:14px/1.4 system-ui, sans-serif; }
  main { height:100%; box-sizing:border-box; padding:28px; display:flex; flex-direction:column; justify-content:center; }
  h1 { margin:0 0 4px; font-size:18px; }
  p { margin:0 0 16px; color:var(--muted); }
  input { width:100%; box-sizing:border-box; padding:10px 12px; font:inherit; color:inherit; background:var(--card); border:1px solid var(--line); border-radius:8px; }
  input:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  .row { display:flex; gap:8px; margin-top:12px; }
  button { flex:1; padding:9px 12px; font:inherit; border-radius:8px; border:1px solid var(--line); background:var(--card); color:inherit; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:disabled { opacity:.6; cursor:default; }
  #err { min-height:1.4em; margin-top:10px; color:var(--err); }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(o.heading)}</h1>
  <p>${escapeHtml(o.body)}</p>
  <form id="f">
    <input id="pw" type="password" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(o.placeholder)}" autofocus>
    <div id="err" role="alert"></div>
    <div class="row">
      <button type="button" id="quit">${escapeHtml(o.cancelLabel)}</button>
      <button type="submit" class="primary" id="go" data-wrong="${escapeHtml(o.wrongMessage)}">${escapeHtml(o.submitLabel)}</button>
    </div>
  </form>
</main>
<script>
  const pw = document.getElementById('pw'), err = document.getElementById('err'), go = document.getElementById('go');
  document.getElementById('quit').addEventListener('click', () => window.unlock.cancel());
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pw.value) return;
    go.disabled = true; err.textContent = '';
    const ok = await window.unlock.submit(pw.value);
    if (!ok) { err.textContent = go.dataset.wrong; pw.select(); go.disabled = false; }
  });
</script>
</body>
</html>`;
}

/**
 * Shows the launch-time password prompt and resolves with the password once `verify` accepts
 * it, or null if the user quits instead. The wrong-password loop lives here: the window stays
 * up and re-prompts until the password is right or the user gives up.
 *
 * This runs before the database is open, so it is its own tiny window with its own preload
 * rather than a route in the React app -- nothing the app normally exposes (IPC handlers,
 * services, the library) exists yet, and none of it is reachable from here.
 */
export function promptForPassword(
  verify: (password: string) => boolean,
  options: PromptOptions = LAUNCH_OPTIONS
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 400,
      height: 300,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: options.heading,
      icon: path.join(__dirname, '../../../assets/icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'unlockPreload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.removeMenu();

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler('unlock:submit');
      ipcMain.removeAllListeners('unlock:cancel');
      resolve(result);
      if (!win.isDestroyed()) win.destroy();
    };

    ipcMain.handle('unlock:submit', (_event, password: unknown) => {
      if (typeof password !== 'string' || !verify(password)) return false;
      finish(password);
      return true;
    });
    ipcMain.once('unlock:cancel', () => finish(null));
    win.on('closed', () => finish(null));

    // Nothing in this window should ever navigate or open another one.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());

    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(options))}`);
  });
}
