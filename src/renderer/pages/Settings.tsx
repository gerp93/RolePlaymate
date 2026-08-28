import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { THEME_LABELS, Theme } from '../utils/themes';
import { CHAT_FONT_SIZES, ChatFontSize, getStoredChatFontSize, saveChatFontSize } from '../utils/chatFontSize';

export default function Settings() {
  const { currentTheme, setTheme, availableThemes } = useTheme();
  const [chatFontSize, setChatFontSize] = useState<ChatFontSize>(() => getStoredChatFontSize());

  const [dbLocation, setDbLocation] = useState<{ path: string; isDefault: boolean; defaultPath: string } | null>(
    null
  );
  const [dbBusy, setDbBusy] = useState(false);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'not-available' | 'error' | 'unsupported'
  >('idle');
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.dbLocation.get().then(setDbLocation);
    window.electronAPI.app.getVersion().then(setAppVersion);
  }, []);

  async function handleCheckForUpdates() {
    setUpdateStatus('checking');
    setUpdateMessage(null);
    const result = await window.electronAPI.updates.check();
    setUpdateStatus(result.status);
    if (result.status === 'available') {
      setUpdateMessage(`Version ${result.version} is downloading in the background.`);
    } else if (result.status === 'error') {
      setUpdateMessage(result.message ?? 'Something went wrong.');
    }
  }

  async function handleUseExistingFile() {
    const picked = await window.electronAPI.dbLocation.browseExisting();
    if (!picked) return;
    setDbBusy(true);
    await window.electronAPI.dbLocation.set(picked);
  }

  async function handleCreateNewLocation() {
    const picked = await window.electronAPI.dbLocation.browseNew();
    if (!picked) return;
    setDbBusy(true);
    await window.electronAPI.dbLocation.set(picked);
  }

  async function handleResetToDefault() {
    if (!confirm(`Switch back to the default database location (${dbLocation?.defaultPath})?`)) return;
    setDbBusy(true);
    await window.electronAPI.dbLocation.resetToDefault();
  }

  async function handleChangePin() {
    setPinMessage(null);
    if (newPin.length < 4 || newPin.length > 20) {
      setPinMessage({ kind: 'error', text: 'New PIN must be 4-20 characters.' });
      return;
    }
    if (newPin !== confirmPin) {
      setPinMessage({ kind: 'error', text: 'New PIN and confirmation do not match.' });
      return;
    }
    if (
      !confirm(
        'Changing your PIN re-encrypts every hidden character, persona, and world book with the new one. ' +
          'If you forget this new PIN, that content cannot be recovered. Continue?'
      )
    ) {
      return;
    }
    setPinBusy(true);
    const result = await window.electronAPI.security.setPin(currentPin, newPin);
    setPinBusy(false);
    if (result.ok) {
      setPinMessage({ kind: 'success', text: 'PIN updated.' });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } else {
      setPinMessage({ kind: 'error', text: result.error ?? 'Could not update the PIN.' });
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Updates</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          {appVersion ? `You're running version ${appVersion}.` : 'Loading version…'}
        </p>
        <button
          className="btn"
          disabled={updateStatus === 'checking' || updateStatus === 'unsupported'}
          onClick={handleCheckForUpdates}
        >
          {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
        </button>
        {updateStatus === 'not-available' && (
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            You're up to date.
          </p>
        )}
        {updateStatus === 'available' && (
          <p style={{ color: 'var(--color-accent-green)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            {updateMessage}
          </p>
        )}
        {updateStatus === 'error' && (
          <p style={{ color: 'var(--color-accent-red)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            Check failed: {updateMessage}
          </p>
        )}
        {updateStatus === 'unsupported' && (
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>
            Update checks are only available in a packaged build, not in dev mode.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Theme</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Choose your preferred color theme for the app.
        </p>
        <div className="field">
          <label>App Theme</label>
          <select
            value={currentTheme || ''}
            onChange={(e) => setTheme(e.target.value as Theme)}
            style={{ maxWidth: 300 }}
          >
            {availableThemes.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Chat Text Size</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Size for message text in chat. Can also be changed from the Chat page itself.
        </p>
        <div className="field">
          <label>Default Text Size</label>
          <select
            value={chatFontSize}
            onChange={(e) => {
              const size = Number(e.target.value) as ChatFontSize;
              setChatFontSize(size);
              saveChatFontSize(size);
            }}
            style={{ maxWidth: 200 }}
          >
            {CHAT_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Hidden Items PIN</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Hidden characters, personas, and world books (and conversations that use them) stay
          out of every list until you unlock them with this PIN from the topbar. 4-20 characters.
        </p>
        <p style={{ color: 'var(--color-accent-red)', fontSize: 13, marginBottom: 12 }}>
          ⚠️ Hidden content is encrypted with this PIN. If you forget a new PIN after changing
          it, that content cannot be recovered.
        </p>
        <div className="field">
          <label>Current PIN*</label>
          <input
            type="password"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            style={{ maxWidth: 200 }}
          />
          <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
            *default PIN is 1234
          </p>
        </div>
        <div className="field">
          <label>New PIN</label>
          <input
            type="password"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            style={{ maxWidth: 200 }}
          />
        </div>
        <div className="field">
          <label>Confirm New PIN</label>
          <input
            type="password"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            style={{ maxWidth: 200 }}
          />
        </div>
        <button
          className="btn"
          disabled={pinBusy || !currentPin || !newPin || !confirmPin}
          onClick={() => void handleChangePin()}
        >
          {pinBusy ? 'Updating…' : 'Change PIN'}
        </button>
        {pinMessage && (
          <p
            style={{
              fontSize: 13,
              marginTop: 8,
              marginBottom: 0,
              color: pinMessage.kind === 'error' ? 'var(--color-accent-red)' : 'var(--color-accent-green)',
            }}
          >
            {pinMessage.text}
          </p>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Database Location</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          RolePlaymate stores everything in a single SQLite file. Point it at a file in a synced folder (OneDrive,
          Dropbox, etc.) to keep an off-device copy, or switch between files for different data sets.
        </p>
        {dbLocation && (
          <>
            <div className="field">
              <label>Current File{dbLocation.isDefault ? ' (default)' : ''}</label>
              <input value={dbLocation.path} readOnly style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" disabled={dbBusy} onClick={handleUseExistingFile}>
                Use Existing File…
              </button>
              <button className="btn" disabled={dbBusy} onClick={handleCreateNewLocation}>
                Create New File Here…
              </button>
              {!dbLocation.isDefault && (
                <button className="btn" disabled={dbBusy} onClick={handleResetToDefault}>
                  Reset to Default
                </button>
              )}
            </div>
            {dbBusy && (
              <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
                Restarting RolePlaymate to load the new location…
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
