import { useCallback, useEffect, useState } from 'react';
import { LorebookEntry, LorebookEntryVersion } from '../../../shared/types/lorebook';
import LimitedInput from '../LimitedInput';
import LimitedTextarea from '../LimitedTextarea';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';

interface Props {
  entry: LorebookEntry;
  onChanged: () => void;
  onDeleted: () => void;
}

/**
 * One lore entry: its trigger configuration, and its versioned text.
 *
 * The version controls mirror the character field editor -- same "save as new version",
 * same active marker, same refusal to delete the last one -- because lore uses the same
 * versioning model rather than a parallel one.
 */
export default function LoreEntryEditor({ entry, onChanged, onDeleted }: Props) {
  const [versions, setVersions] = useState<LorebookEntryVersion[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState(entry.title);
  const [keys, setKeys] = useState(entry.keys);
  const [alwaysOn, setAlwaysOn] = useState(entry.alwaysOn);
  const [enabled, setEnabled] = useState(entry.enabled);
  const [priority, setPriority] = useState(entry.priority);
  const [open, setOpen] = useState(false);

  const active = versions.find((v) => v.isActive) ?? null;
  // What the editor is showing. Defaults to the active version, but older ones can be
  // opened to read or amend -- the active one is still what the model gets.
  const viewing = versions.find((v) => v.id === viewingId) ?? active;

  // The version to keep showing is passed in rather than read from state: depending on
  // `viewingId` here would change this callback's identity on every selection, re-run the
  // effect below, and immediately reset the selection back to the active version.
  const loadVersions = useCallback(
    async (keepVersionId?: string) => {
      const loaded = await window.electronAPI.loreVersions.getByEntry(entry.id);
      setVersions(loaded);
      const next =
        (keepVersionId && loaded.find((v) => v.id === keepVersionId)) ||
        loaded.find((v) => v.isActive);
      setViewingId(next?.id ?? null);
      setDraft(next?.content ?? '');
    },
    [entry.id]
  );

  useEffect(() => {
    if (open) void loadVersions();
  }, [open, loadVersions]);

  // Re-sync when the entry row itself changes underneath (e.g. after a save elsewhere).
  useEffect(() => {
    setTitle(entry.title);
    setKeys(entry.keys);
    setAlwaysOn(entry.alwaysOn);
    setEnabled(entry.enabled);
    setPriority(entry.priority);
  }, [entry]);

  const saveSettings = async () => {
    await window.electronAPI.loreEntries.update(entry.id, {
      title,
      keys,
      alwaysOn,
      enabled,
      priority,
    });
    onChanged();
  };

  const saveText = async () => {
    if (!viewing) return;
    await window.electronAPI.loreVersions.updateContent(viewing.id, draft);
    await loadVersions(viewing.id);
  };

  const saveAsNewVersion = async () => {
    await window.electronAPI.loreVersions.create(entry.id, draft);
    await loadVersions();
  };

  const keyCount = keys.split(',').map((k) => k.trim()).filter(Boolean).length;
  const noTrigger = !alwaysOn && keyCount === 0;

  return (
    <li className={`lore-entry${enabled ? '' : ' lore-entry-disabled'}`}>
      <div className="lore-entry-head">
        <button type="button" className="lore-entry-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} {entry.title}
        </button>
        <span className="lore-entry-badges">
          {entry.alwaysOn && <span className="lore-badge lore-badge-always">always on</span>}
          {!entry.alwaysOn && <span className="lore-badge">{keyCount} keys</span>}
          {entry.priority !== 0 && <span className="lore-badge">p{entry.priority}</span>}
          {!entry.enabled && <span className="lore-badge lore-badge-off">disabled</span>}
        </span>
        <button type="button" className="btn btn-danger lore-entry-delete" onClick={onDeleted}>
          Delete
        </button>
      </div>

      {noTrigger && (
        <p className="lore-entry-warning">
          No keys and not always-on — this entry can never fire.
        </p>
      )}

      {open && (
        <div className="lore-entry-body">
          <div className="field">
            <label htmlFor={`title-${entry.id}`}>Title</label>
            <LimitedInput
              id={`title-${entry.id}`}
              limit={FIELD_LIMITS.name}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void saveSettings()}
            />
          </div>

          <div className="field">
            <label htmlFor={`keys-${entry.id}`}>
              Trigger keys <span className="text-muted">— comma separated, whole-word match</span>
            </label>
            <LimitedInput
              id={`keys-${entry.id}`}
              limit={FIELD_LIMITS.loreKeys}
              value={keys}
              disabled={alwaysOn}
              placeholder="Kestrel, the ship, cargo hauler"
              onChange={(e) => setKeys(e.target.value)}
              onBlur={() => void saveSettings()}
            />
          </div>

          <div className="lore-entry-flags">
            <label>
              <input
                type="checkbox"
                checked={alwaysOn}
                onChange={(e) => {
                  setAlwaysOn(e.target.checked);
                  void window.electronAPI.loreEntries
                    .update(entry.id, { alwaysOn: e.target.checked })
                    .then(onChanged);
                }}
              />
              Always on <span className="text-muted">(ignores keys)</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  void window.electronAPI.loreEntries
                    .update(entry.id, { enabled: e.target.checked })
                    .then(onChanged);
                }}
              />
              Enabled
            </label>
            <label className="lore-priority">
              Priority
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                onBlur={() => void saveSettings()}
              />
              <span className="text-muted">higher wins under budget pressure</span>
            </label>
          </div>

          <div className="field">
            <label htmlFor={`content-${entry.id}`}>
              Text{' '}
              {viewing && (
                <span className="text-muted">
                  — v{viewing.versionNumber} of {versions.length}
                  {viewing.isActive ? ' (active)' : ' — not the version the model sees'}
                </span>
              )}
            </label>
            <LimitedTextarea
              id={`content-${entry.id}`}
              limit={FIELD_LIMITS.loreText}
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void saveText()}
              placeholder="What the model should know when this entry fires."
            />
          </div>

          {versions.length > 1 && (
            <div className="lore-versions">
              {versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  className={`btn lore-version${version.id === viewing?.id ? ' viewing' : ''}${
                    version.isActive ? ' active' : ''
                  }`}
                  title={
                    version.isActive
                      ? 'Active version — this is what the model sees'
                      : 'View this version'
                  }
                  onClick={() => {
                    setViewingId(version.id);
                    setDraft(version.content);
                  }}
                >
                  v{version.versionNumber}
                  {version.isActive ? ' ★' : ''}
                </button>
              ))}
            </div>
          )}

          <div className="lore-entry-actions">
            <button type="button" className="btn" onClick={() => void saveAsNewVersion()}>
              Save as New Version
            </button>
            {versions.length > 1 && viewing && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  await window.electronAPI.loreVersions.delete(viewing.id);
                  await loadVersions();
                }}
              >
                Delete v{viewing.versionNumber}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
