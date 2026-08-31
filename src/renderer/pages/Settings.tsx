import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { THEME_LABELS, Theme } from '../utils/themes';
import LimitedInput from '../components/LimitedInput';
import CopyableTerminalCommand from '../components/CopyableTerminalCommand';
import CharacterVoicePicker from '../components/CharacterVoicePicker';
import RetentionRulesPanel from '../components/RetentionRulesPanel';
import VoicePreview from '../components/VoicePreview';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { DEFAULT_EMBEDDING_MODEL, isEmbeddingModel } from '../../shared/embeddingModel';
import { CharacterTtsVoice, ChatterboxCloneVoice, ChatterboxPredefinedVoice } from '../../shared/types/tts';
import { normalizeCloneVoices, stemFromVoiceName } from '../../shared/utils/ttsPreview';
import { useVoicePreview, VoicePreviewState } from '../hooks/useVoicePreview';

function SettingsVoiceTable({
  rows,
  mode,
  preview,
  onDelete,
  deleteBusy,
}: {
  rows: { filename: string; displayName: string }[];
  mode: 'clone' | 'predefined';
  preview: VoicePreviewState;
  onDelete?: (filename: string, displayName: string) => void;
  deleteBusy?: boolean;
}) {
  return (
    <table className={`settings-clone-table${onDelete ? ' has-actions' : ''}`}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Filename</th>
          <th>Preview</th>
          {onDelete && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${mode}:${row.filename}`}>
            <td className="settings-clone-name">{row.displayName}</td>
            <td className="settings-clone-filename">{row.filename}</td>
            <td>
              <VoicePreview
                voice={{ mode, id: row.filename }}
                preview={preview}
                showLabel={false}
              />
            </td>
            {onDelete && (
              <td>
                <button
                  type="button"
                  className="btn"
                  disabled={deleteBusy}
                  onClick={() => onDelete(row.filename, row.displayName)}
                >
                  Delete
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type SettingsTab = 'general' | 'servers' | 'data' | 'security';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'servers', label: 'Chat Dependencies' },
  { id: 'data', label: 'Data' },
  { id: 'security', label: 'Security' },
];

function parseSettingsTab(raw: string | null): SettingsTab {
  if (raw === 'servers' || raw === 'data' || raw === 'security') return raw;
  return 'general';
}

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseSettingsTab(searchParams.get('tab'));
  const { currentTheme, setTheme, availableThemes } = useTheme();
  const [retentionDraftUnsaved, setRetentionDraftUnsaved] = useState(false);

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

  const [chatterboxHost, setChatterboxHostState] = useState<{
    host: string;
    isDefault: boolean;
    defaultHost: string;
  } | null>(null);
  const [chatterboxHostDraft, setChatterboxHostDraft] = useState('');
  const [chatterboxBusy, setChatterboxBusy] = useState(false);
  const [chatterboxError, setChatterboxError] = useState<string | null>(null);
  const [chatterboxReachable, setChatterboxReachable] = useState<boolean | null>(null);
  const [narratorVoice, setNarratorVoice] = useState<CharacterTtsVoice | null>(null);
  const [cloneVoices, setCloneVoices] = useState<ChatterboxCloneVoice[]>([]);
  const [stockVoices, setStockVoices] = useState<ChatterboxPredefinedVoice[]>([]);
  const [cloneName, setCloneName] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneNotice, setCloneNotice] = useState<string | null>(null);
  const [voiceListKey, setVoiceListKey] = useState(0);
  const voicePreview = useVoicePreview();

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
    window.electronAPI.chatterboxHost.get().then((result) => {
      setChatterboxHostState(result);
      setChatterboxHostDraft(result.host);
    });
    void window.electronAPI.narratorVoice.get().then(setNarratorVoice);
    void refreshChatterboxStatus();
    void refreshEmbeddingSettings();
  }, []);

  async function refreshChatterboxStatus() {
    const status = await window.electronAPI.tts.status();
    setChatterboxReachable(status.reachable);
    setCloneVoices(normalizeCloneVoices(status.clones));
    setStockVoices(status.predefined ?? []);
    setVoiceListKey((n) => n + 1);
  }

  async function handleImportClone() {
    if (!chatterboxReachable) return;
    const name = cloneName.trim();
    if (!stemFromVoiceName(name)) {
      setCloneNotice('Give this voice a name before importing.');
      return;
    }
    setCloneBusy(true);
    setCloneNotice(null);
    try {
      const result = await window.electronAPI.tts.importClone(name);
      if (result.status === 'cancelled') return;
      if (result.status === 'unavailable') {
        setCloneNotice('Chatterbox is not reachable.');
        setChatterboxReachable(false);
        return;
      }
      if (result.status === 'error') {
        setCloneNotice(result.message);
        return;
      }
      setCloneName('');
      setCloneNotice(`Imported ${result.filename}.`);
      await refreshChatterboxStatus();
    } finally {
      setCloneBusy(false);
    }
  }

  async function handleDeleteClone(filename: string, displayName: string) {
    if (!chatterboxReachable) return;
    if (!confirm(`Delete ${displayName} (${filename}) from Chatterbox? Characters using it will fall back to the narrator (or stay silent).`)) {
      return;
    }
    setCloneBusy(true);
    setCloneNotice(null);
    try {
      const result = await window.electronAPI.tts.deleteClone(filename);
      if (result.status === 'unavailable') {
        setCloneNotice('Chatterbox is not reachable.');
        setChatterboxReachable(false);
        return;
      }
      if (result.status === 'error') {
        setCloneNotice(result.message);
        return;
      }
      if (result.narratorCleared) setNarratorVoice(null);
      setCloneNotice(`Deleted ${displayName}.`);
      await refreshChatterboxStatus();
    } finally {
      setCloneBusy(false);
    }
  }

  async function handleRevealCloneFolder() {
    setCloneNotice(null);
    const result = await window.electronAPI.tts.revealCloneFolder();
    if (result.status === 'unavailable') {
      setCloneNotice('Chatterbox is not reachable.');
      setChatterboxReachable(false);
      return;
    }
    if (result.status === 'error') setCloneNotice(result.message);
  }

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

  async function persistChatterboxHostIfChanged() {
    const trimmed = chatterboxHostDraft.trim();
    if (!chatterboxHost || !trimmed || trimmed === chatterboxHost.host) return;
    setChatterboxBusy(true);
    setChatterboxError(null);
    try {
      await window.electronAPI.chatterboxHost.set(trimmed);
      const result = await window.electronAPI.chatterboxHost.get();
      setChatterboxHostState(result);
      setChatterboxHostDraft(result.host);
      await refreshChatterboxStatus();
    } catch (err) {
      setChatterboxError(err instanceof Error ? err.message : 'Invalid server URL.');
      setChatterboxHostDraft(chatterboxHost.host);
    } finally {
      setChatterboxBusy(false);
    }
  }

  async function handleResetChatterboxHost() {
    setChatterboxBusy(true);
    setChatterboxError(null);
    try {
      await window.electronAPI.chatterboxHost.resetToDefault();
      const result = await window.electronAPI.chatterboxHost.get();
      setChatterboxHostState(result);
      setChatterboxHostDraft(result.host);
      await refreshChatterboxStatus();
    } finally {
      setChatterboxBusy(false);
    }
  }

  async function handleNarratorVoiceChange(voice: CharacterTtsVoice | null) {
    setNarratorVoice(voice);
    setChatterboxError(null);
    try {
      await window.electronAPI.narratorVoice.set(voice);
    } catch (err) {
      setChatterboxError(err instanceof Error ? err.message : 'Could not save narrator voice.');
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

  function selectTab(next: SettingsTab) {
    if (tab === 'data' && next !== 'data' && retentionDraftUnsaved) {
      if (!window.confirm("This rule isn't saved because it doesn't have every field set. Leave this page and discard it?")) {
        return;
      }
    }
    if (next === 'general') setSearchParams({}, { replace: true });
    else setSearchParams({ tab: next }, { replace: true });
  }

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`settings-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`settings-panel-${item.id}`}
            className={`settings-tab${tab === item.id ? ' active' : ''}`}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="settings-tab-panels">
        {tab === 'general' && (
          <div
            role="tabpanel"
            id="settings-panel-general"
            aria-labelledby="settings-tab-general"
          >
      <div className="card">
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

      <div className="card">
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
          </div>
        )}

        {tab === 'security' && (
          <div
            role="tabpanel"
            id="settings-panel-security"
            aria-labelledby="settings-tab-security"
          >
      <div className="card">
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
          </div>
        )}

        {tab === 'data' && (
          <div
            role="tabpanel"
            id="settings-panel-data"
            aria-labelledby="settings-tab-data"
          >
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

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Data Retention</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Delete old chats (and their spoken audio) to free disk space. Characters, personas,
          scenarios, and lore are never removed. With no rules, chats are kept forever. A chat
          matching any rule is deleted when you click Clean up now. Rules with automatic cleanup
          enabled also run when you open the app and at local midnight while it is running. Saving
          a rule does not delete anything. Each rule has a library items filter. Leave it empty to
          delete every chat that matches the age and message filters. Add library items to limit the
          rule: Any of these matches a chat that involves any selected character, persona, or world
          book; Every type requires at least one of each type you add. When you add a character,
          pick a scenario or all scenarios. Message count includes the opening greeting. Mark a
          conversation &quot;Keep&quot; in Chat Settings to exempt it.
        </p>
        <RetentionRulesPanel onUnsavedDraftChange={setRetentionDraftUnsaved} />
      </div>
          </div>
        )}

        {tab === 'servers' && (
          <div
            role="tabpanel"
            id="settings-panel-servers"
            aria-labelledby="settings-tab-servers"
          >
      <div className="card">
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

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Chatterbox Voice</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Optional local TTS server for spoken character replies. RolePlaymate does not ship a
          voice model — chat still works when this isn&apos;t running. Default is Chatterbox TTS
          Server at {chatterboxHost?.defaultHost ?? 'http://localhost:8004'}. See{' '}
          <a href="https://github.com/devnen/Chatterbox-TTS-Server" target="_blank" rel="noreferrer">
            Chatterbox TTS Server
          </a>
          .
        </p>
        {chatterboxHost && (
          <>
            <div className="field">
              <label>Server URL{chatterboxHost.isDefault ? ' (default)' : ''}</label>
              <LimitedInput
                value={chatterboxHostDraft}
                limit={FIELD_LIMITS.url}
                onChange={(e) => {
                  setChatterboxHostDraft(e.target.value);
                  setChatterboxError(null);
                }}
                onBlur={() => void persistChatterboxHostIfChanged()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder={chatterboxHost.defaultHost}
                style={{ maxWidth: 300, fontFamily: 'monospace', fontSize: 12 }}
              />
              <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                *Chatterbox&apos;s default is {chatterboxHost.defaultHost}
              </p>
            </div>
            {!chatterboxHost.isDefault && (
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn"
                  disabled={chatterboxBusy}
                  onClick={() => void handleResetChatterboxHost()}
                >
                  Reset to Default
                </button>
              </div>
            )}
            {chatterboxError && (
              <p style={{ color: 'var(--color-accent-red)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                {chatterboxError}
              </p>
            )}
            {chatterboxReachable !== null && (
              <p
                className="settings-embedding-status"
                data-installed={chatterboxReachable ? 'true' : 'false'}
                style={{ marginTop: 12 }}
              >
                {chatterboxReachable
                  ? 'Chatterbox is reachable.'
                  : 'Chatterbox is not reachable. Spoken replies will stay silent.'}
              </p>
            )}
            <div className="settings-subsection-actions">
              <button
                className="btn"
                disabled={chatterboxBusy}
                onClick={() => void refreshChatterboxStatus()}
              >
                Check again
              </button>
            </div>
            <section className="settings-subsection">
              <h3 className="settings-subsection-title">Voices</h3>
              <p className="text-muted settings-subsection-lead">
                Narrator is the fallback when a character or persona has no voice of its own.
                Custom voices are WAV or MP3 clips you import (not MP4). Chatterbox voices ship
                with the server.
              </p>
              <CharacterVoicePicker
                value={narratorVoice}
                onChange={(voice) => void handleNarratorVoiceChange(voice)}
                preview={voicePreview}
                label="Narrator voice"
                noneLabel="None — characters without a voice stay silent"
                reloadToken={voiceListKey}
                description={
                  <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                    Used whenever the current character or persona has no spoken voice of its own,
                    or when Chat Settings → Who reads is set to Narrator or Split italics (*action*
                    goes to this voice). A character or persona voice still wins for their own
                    &quot;all&quot; setting when one is set.
                  </p>
                }
              />
              {chatterboxReachable && (
                <>
                  <details className="settings-clip-panel">
                    <summary className="settings-clip-summary">Custom voices</summary>
                    <p className="text-muted settings-subsection-lead">
                      Import a WAV or MP3 without opening Chatterbox. Every clip needs a voice name;
                      that name is what pickers show, and the file is stored as that name plus its
                      extension.
                    </p>
                    <div className="settings-clone-import">
                      <div className="field">
                        <label>Voice name</label>
                        <LimitedInput
                          value={cloneName}
                          limit={FIELD_LIMITS.name}
                          compactCount
                          onChange={(e) => setCloneName(e.target.value)}
                          placeholder="Lizzy"
                        />
                      </div>
                      <div className="settings-clone-import-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={cloneBusy || !stemFromVoiceName(cloneName)}
                          onClick={() => void handleImportClone()}
                        >
                          {cloneBusy ? 'Working…' : 'Import WAV or MP3…'}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={cloneBusy}
                          onClick={() => void handleRevealCloneFolder()}
                        >
                          Show in Explorer
                        </button>
                      </div>
                    </div>
                    {cloneNotice && <p className="text-muted settings-subsection-notice">{cloneNotice}</p>}
                    {voicePreview.error && voicePreview.activeKey?.startsWith('clone:') && (
                      <p className="text-muted settings-subsection-notice">{voicePreview.error}</p>
                    )}
                    {cloneVoices.length === 0 ? (
                      <p className="text-muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
                        No custom voices yet.
                      </p>
                    ) : (
                      <SettingsVoiceTable
                        rows={cloneVoices}
                        mode="clone"
                        preview={voicePreview}
                        deleteBusy={cloneBusy}
                        onDelete={(filename, displayName) => void handleDeleteClone(filename, displayName)}
                      />
                    )}
                  </details>
                  <details className="settings-clip-panel">
                    <summary className="settings-clip-summary">Chatterbox voices</summary>
                    <p className="text-muted settings-subsection-lead">
                      These ship with Chatterbox. Preview them here; they can&apos;t be imported or
                      deleted from RolePlaymate.
                    </p>
                    {voicePreview.error && voicePreview.activeKey?.startsWith('predefined:') && (
                      <p className="text-muted settings-subsection-notice">{voicePreview.error}</p>
                    )}
                    {stockVoices.length === 0 ? (
                      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                        Chatterbox didn&apos;t list any stock voices.
                      </p>
                    ) : (
                      <SettingsVoiceTable rows={stockVoices} mode="predefined" preview={voicePreview} />
                    )}
                  </details>
                </>
              )}
            </section>
          </>
        )}
      </div>
          </div>
        )}
      </div>
    </div>
  );
}
