import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { THEME_LABELS, Theme } from '../utils/themes';
import LimitedInput from '../components/LimitedInput';
import CopyableTerminalCommand from '../components/CopyableTerminalCommand';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { DEFAULT_EMBEDDING_MODEL, isEmbeddingModel } from '../../shared/embeddingModel';

export default function Settings() {
  const { currentTheme, setTheme, availableThemes } = useTheme();

  const [dbLocation, setDbLocation] = useState<{ path: string; isDefault: boolean; defaultPath: string } | null>(
    null
  );
  const [dbBusy, setDbBusy] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const [ollamaHost, setOllamaHostState] = useState<{ host: string; isDefault: boolean; defaultHost: string } | null>(
    null
  );
  const [ollamaHostDraft, setOllamaHostDraft] = useState('');
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

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

  const [embeddingInstalled, setEmbeddingInstalled] = useState<boolean | null>(null);
  const [configuredEmbeddingModel, setConfiguredEmbeddingModel] = useState<string | null>(null);
  const [embeddingModelIsDefault, setEmbeddingModelIsDefault] = useState(true);
  const [installedEmbeddingModels, setInstalledEmbeddingModels] = useState<string[]>([]);
  const [embeddingModelBusy, setEmbeddingModelBusy] = useState(false);
  const [remindWhenEmbeddingMissing, setRemindWhenEmbeddingMissing] = useState(true);
  const [embeddingChecking, setEmbeddingChecking] = useState(false);
  const [embeddingNotice, setEmbeddingNotice] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.dbLocation.get().then(setDbLocation);
    window.electronAPI.app.getVersion().then(setAppVersion);
    window.electronAPI.ollamaHost.get().then((result) => {
      setOllamaHostState(result);
      setOllamaHostDraft(result.host);
    });
    void refreshEmbeddingSettings();
  }, []);

  useEffect(() => {
    function onFocus() {
      void refreshEmbeddingSettings();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function refreshEmbeddingSettings() {
    const [status, prompt, config, modelsResult] = await Promise.all([
      window.electronAPI.ollama.getEmbeddingModelStatus(),
      window.electronAPI.embeddingModelPrompt.getSuppressed(),
      window.electronAPI.memoryEmbeddingModel.get(),
      window.electronAPI.ollama.listModelsDetailed(),
    ]);
    setConfiguredEmbeddingModel(config.model);
    setEmbeddingModelIsDefault(config.isDefault);
    setEmbeddingInstalled(status.ollamaReachable && status.installed);
    setRemindWhenEmbeddingMissing(!prompt.suppressed);
    if (modelsResult.available) {
      setInstalledEmbeddingModels(
        modelsResult.models.filter((m) => isEmbeddingModel(m)).map((m) => m.name)
      );
    } else {
      setInstalledEmbeddingModels([]);
    }
  }

  const activeEmbeddingModel = configuredEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const embeddingPullCommand = `ollama pull ${activeEmbeddingModel}`;
  const embeddingModelOptions = [
    ...new Set([activeEmbeddingModel, ...installedEmbeddingModels]),
  ].sort((a, b) => a.localeCompare(b));

  async function handleEmbeddingModelChange(model: string) {
    if (model === activeEmbeddingModel) return;
    setEmbeddingModelBusy(true);
    setEmbeddingNotice(null);
    try {
      await window.electronAPI.memoryEmbeddingModel.set(model);
      await refreshEmbeddingSettings();
    } catch (err) {
      setEmbeddingNotice(err instanceof Error ? err.message : 'Could not save embedding model.');
    } finally {
      setEmbeddingModelBusy(false);
    }
  }

  async function handleResetEmbeddingModel() {
    setEmbeddingModelBusy(true);
    setEmbeddingNotice(null);
    try {
      await window.electronAPI.memoryEmbeddingModel.resetToDefault();
      await refreshEmbeddingSettings();
    } catch (err) {
      setEmbeddingNotice(err instanceof Error ? err.message : 'Could not reset embedding model.');
    } finally {
      setEmbeddingModelBusy(false);
    }
  }

  async function handleEmbeddingCheck() {
    setEmbeddingChecking(true);
    setEmbeddingNotice(null);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      const status = await window.electronAPI.ollama.getEmbeddingModelStatus();
      const installed = status.ollamaReachable && status.installed;
      setEmbeddingInstalled(installed);
      if (!installed) {
        setEmbeddingNotice(`The ${status.model} model is not installed in Ollama yet.`);
      }
    } finally {
      setEmbeddingChecking(false);
    }
  }

  async function handleRemindWhenEmbeddingMissingChange(checked: boolean) {
    setRemindWhenEmbeddingMissing(checked);
    await window.electronAPI.embeddingModelPrompt.setSuppressed(!checked);
  }

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

  async function handleShowDbInFolder() {
    setDbError(null);
    try {
      await window.electronAPI.dbLocation.showInFolder();
    } catch (err) {
      setDbError(err instanceof Error ? err.message : 'Could not open the database folder.');
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

  async function persistOllamaHostIfChanged() {
    const trimmed = ollamaHostDraft.trim();
    if (!ollamaHost || !trimmed || trimmed === ollamaHost.host) return;
    setOllamaBusy(true);
    setOllamaError(null);
    try {
      await window.electronAPI.ollamaHost.set(trimmed);
      const result = await window.electronAPI.ollamaHost.get();
      setOllamaHostState(result);
      setOllamaHostDraft(result.host);
    } catch (err) {
      setOllamaError(err instanceof Error ? err.message : 'Invalid server URL.');
      setOllamaHostDraft(ollamaHost.host);
    } finally {
      setOllamaBusy(false);
    }
  }

  async function handleResetOllamaHost() {
    setOllamaBusy(true);
    setOllamaError(null);
    try {
      await window.electronAPI.ollamaHost.resetToDefault();
      const result = await window.electronAPI.ollamaHost.get();
      setOllamaHostState(result);
      setOllamaHostDraft(result.host);
    } finally {
      setOllamaBusy(false);
    }
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
              <button className="btn" disabled={dbBusy} onClick={() => void handleShowDbInFolder()}>
                Show in Explorer
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
            {dbError && (
              <p style={{ color: 'var(--color-accent-red)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                {dbError}
              </p>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Ollama Server</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          The local Ollama server RolePlaymate talks to for chat. Change this if it&apos;s
          running on a different port, or on another machine on your network.
        </p>
        {ollamaHost && (
          <>
            <div className="field">
              <label>Server URL{ollamaHost.isDefault ? ' (default)' : ''}</label>
              <LimitedInput
                value={ollamaHostDraft}
                limit={FIELD_LIMITS.url}
                onChange={(e) => {
                  setOllamaHostDraft(e.target.value);
                  setOllamaError(null);
                }}
                onBlur={() => void persistOllamaHostIfChanged()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder={ollamaHost.defaultHost}
                style={{ maxWidth: 300, fontFamily: 'monospace', fontSize: 12 }}
              />
              <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                *Ollama&apos;s default is {ollamaHost.defaultHost}
              </p>
            </div>
            {!ollamaHost.isDefault && (
              <div style={{ marginTop: 8 }}>
                <button className="btn" disabled={ollamaBusy} onClick={() => void handleResetOllamaHost()}>
                  Reset to Default
                </button>
              </div>
            )}
            {ollamaError && (
              <p style={{ color: 'var(--color-accent-red)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                {ollamaError}
              </p>
            )}
          </>
        )}

        <section className="settings-subsection">
          <h3 className="settings-subsection-title">Memory embedding model</h3>
          <p className="text-muted settings-subsection-lead">
            Unpinned memories are matched by meaning through the selected Ollama embedding model.
            This model is not required for chat, but without it characters are more likely to forget
            earlier parts of a conversation as it grows — only pinned memories are always included.
          </p>
          <div className="field">
            <label>Active model{embeddingModelIsDefault ? ' (default)' : ''}</label>
            <select
              value={activeEmbeddingModel}
              disabled={embeddingModelBusy || embeddingModelOptions.length === 0}
              onChange={(e) => void handleEmbeddingModelChange(e.target.value)}
              style={{ maxWidth: 360, fontFamily: 'monospace', fontSize: 12 }}
            >
              {embeddingModelOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
              Pull additional embedding models with Ollama, then choose them here. See{' '}
              <Link to="/model-tuning">Model Tuning</Link> for installed embedding models.
            </p>
          </div>
          {!embeddingModelIsDefault && (
            <div style={{ marginTop: 8 }}>
              <button
                className="btn"
                disabled={embeddingModelBusy}
                onClick={() => void handleResetEmbeddingModel()}
              >
                Reset to Default ({DEFAULT_EMBEDDING_MODEL})
              </button>
            </div>
          )}
          {embeddingInstalled !== null && (
            <p
              className="settings-embedding-status"
              data-installed={embeddingInstalled ? 'true' : 'false'}
            >
            {embeddingInstalled
              ? `The ${activeEmbeddingModel} model is installed.`
              : `The ${activeEmbeddingModel} model is not installed.`}
            </p>
          )}
          {embeddingInstalled === false && (
            <CopyableTerminalCommand command={embeddingPullCommand} />
          )}
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={remindWhenEmbeddingMissing}
              onChange={(e) => void handleRemindWhenEmbeddingMissingChange(e.target.checked)}
            />
            Remind me on the Chat page when the embedding model is missing
          </label>
          <div className="settings-subsection-actions">
            <button className="btn" disabled={embeddingChecking} onClick={() => void handleEmbeddingCheck()}>
              {embeddingChecking ? 'Checking…' : 'Check again'}
            </button>
          </div>
          {embeddingNotice && <p className="text-muted settings-subsection-notice">{embeddingNotice}</p>}
        </section>
      </div>
    </div>
  );
}
