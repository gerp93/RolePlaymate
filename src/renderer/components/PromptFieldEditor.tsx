import { useEffect, useRef, useState } from 'react';
import { PromptFieldVersion, PromptTemplates } from '../../shared/types/promptTemplates';
import VersionSwitcher from './VersionSwitcher';

interface Props {
  fieldKey: keyof PromptTemplates;
  label: string;
  when: string;
  tag: string;
}

const AUTOSAVE_DELAY_MS = 800;

function latestOf(versions: PromptFieldVersion[]): PromptFieldVersion | null {
  return versions.length ? versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a)) : null;
}

/** Enough rows to show the whole thing without an initial scroll, plus a little breathing
 * room -- the templates range from a couple of lines (directions) to a dozen (character rules). */
function rowsFor(text: string): number {
  return Math.max(3, text.split('\n').length + 2);
}

/**
 * Version-history editor for one system-prompt template field, adapted from FieldEditor.tsx:
 * same load/select/autosave/duplicate/delete flow against promptFieldVersions:* instead of
 * fieldVersions:*, keyed by the field's fixed `fieldKey` instead of a character field id. No
 * preview/edit toggle or FormattedContent -- these are technical {char}-placeholder templates,
 * not {{char}}-style character prose, so they're always shown as an editable textarea. Adds a
 * "Reset to Default" button FieldEditor doesn't need, which -- unlike character fields, which
 * have no built-in default to reset to -- creates a NEW version holding the original default
 * text rather than reverting or deleting anything.
 */
export default function PromptFieldEditor({ fieldKey, label, when, tag }: Props) {
  const [versions, setVersions] = useState<PromptFieldVersion[]>([]);
  const [viewedVersionId, setViewedVersionId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [busy, setBusy] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ id: string; content: string } | null>(null);

  useEffect(() => {
    load();
    return () => {
      flushPendingSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey]);

  async function load(preferViewedId?: string) {
    const list = await window.electronAPI.promptFieldVersions.getByField(fieldKey);
    setVersions(list);
    const target = list.find((v) => v.id === preferViewedId) ?? latestOf(list);
    selectViewed(target ?? null);
  }

  function selectViewed(version: PromptFieldVersion | null) {
    flushPendingSave();
    setViewedVersionId(version?.id ?? null);
    setDraftContent(version?.content ?? '');
    setSaveState('idle');
  }

  function handleSelectViewed(versionId: string) {
    const version = versions.find((v) => v.id === versionId) ?? null;
    selectViewed(version);
  }

  async function handleSaveAsNewVersion() {
    if (!viewedVersionId) return;
    flushPendingSave();
    setBusy(true);
    const created = await window.electronAPI.promptFieldVersions.duplicate(viewedVersionId);
    await load(created.id);
    setBusy(false);
  }

  async function handleDeleteVersion(versionId: string) {
    if (!confirm('Delete this version? This cannot be undone.')) return;
    setBusy(true);
    await window.electronAPI.promptFieldVersions.delete(versionId);
    await load();
    setBusy(false);
  }

  async function handleResetToDefault() {
    flushPendingSave();
    setBusy(true);
    const created = await window.electronAPI.promptFieldVersions.resetToDefault(fieldKey);
    await load(created.id);
    setBusy(false);
  }

  function scheduleSave(nextContent: string) {
    if (!viewedVersionId) return;
    pendingSave.current = { id: viewedVersionId, content: nextContent };
    setSaveState('pending');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      flushPendingSave();
    }, AUTOSAVE_DELAY_MS);
  }

  async function flushPendingSave() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    if (!pending) return;
    pendingSave.current = null;
    setSaveState('saving');
    await window.electronAPI.promptFieldVersions.updateContent(pending.id, pending.content);
    setVersions((prev) => prev.map((v) => (v.id === pending.id ? { ...v, content: pending.content } : v)));
    setSaveState('saved');
  }

  function handleContentChange(next: string) {
    setDraftContent(next);
    scheduleSave(next);
  }

  const latestVersion = latestOf(versions);
  const isEditable = !!latestVersion && viewedVersionId === latestVersion.id;

  if (versions.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>{label}</h2>
      <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
        {when}
      </p>

      <VersionSwitcher versions={versions} viewedVersionId={viewedVersionId} onSelectViewed={handleSelectViewed} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {!isEditable
            ? 'Read-only — only the latest version is editable'
            : saveState === 'saving'
              ? 'Saving…'
              : saveState === 'pending'
                ? 'Editing…'
                : saveState === 'saved'
                  ? 'Saved'
                  : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={handleResetToDefault}>
          Reset to Default
        </button>
        <button className="btn" disabled={busy} onClick={handleSaveAsNewVersion}>
          Save as New Version
        </button>
        {viewedVersionId && versions.length > 1 && (
          <button className="btn btn-danger" disabled={busy} onClick={() => handleDeleteVersion(viewedVersionId)}>
            Delete Version
          </button>
        )}
      </div>

      <div className="text-muted" style={{ fontFamily: 'monospace', fontSize: 13, padding: '2px 0' }} title="Fixed -- not editable">
        [{tag}]
      </div>
      <textarea
        rows={rowsFor(draftContent)}
        value={draftContent}
        onChange={(e) => isEditable && handleContentChange(e.target.value)}
        readOnly={!isEditable}
        style={{ fontFamily: 'monospace', fontSize: 13, width: '100%', resize: 'vertical', display: 'block' }}
      />
      <div className="text-muted" style={{ fontFamily: 'monospace', fontSize: 13, padding: '2px 0' }} title="Fixed -- not editable">
        [/{tag}]
      </div>
    </div>
  );
}
