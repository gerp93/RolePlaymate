import { useEffect, useRef, useState } from 'react';
import { CharacterField, FIELD_LABELS } from '../../shared/types/characterField';
import { CharacterFieldVersion } from '../../shared/types/fieldVersion';
import VersionSwitcher from './VersionSwitcher';
import FormattedContent from './FormattedContent';

interface Props {
  field: CharacterField;
  placeholder: string;
}

const AUTOSAVE_DELAY_MS = 800;

function latestOf(versions: CharacterFieldVersion[]): CharacterFieldVersion | null {
  return versions.length ? versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a)) : null;
}

export default function FieldEditor({ field, placeholder }: Props) {
  const [versions, setVersions] = useState<CharacterFieldVersion[]>([]);
  const [viewedVersionId, setViewedVersionId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ id: string; content: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    load();
    return () => {
      flushPendingSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.id]);

  async function load(preferViewedId?: string) {
    const list = await window.electronAPI.fieldVersions.getByField(field.id);
    setVersions(list);
    const target = list.find((v) => v.id === preferViewedId) ?? latestOf(list);
    selectViewed(target ?? null);
  }

  function selectViewed(version: CharacterFieldVersion | null) {
    flushPendingSave();
    setViewedVersionId(version?.id ?? null);
    setDraftContent(version?.content ?? '');
    setSaveState('idle');
    setMode('preview');
  }

  function handleSelectViewed(versionId: string) {
    const version = versions.find((v) => v.id === versionId) ?? null;
    selectViewed(version);
  }

  async function handleSaveAsNewVersion() {
    if (!viewedVersionId) return;
    flushPendingSave();
    const created = await window.electronAPI.fieldVersions.duplicate(viewedVersionId);
    await load(created.id);
  }

  async function handleDeleteVersion(versionId: string) {
    if (!confirm('Delete this version? This cannot be undone.')) return;
    await window.electronAPI.fieldVersions.delete(versionId);
    await load();
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
    await window.electronAPI.fieldVersions.updateContent(pending.id, pending.content);
    setVersions((prev) => prev.map((v) => (v.id === pending.id ? { ...v, content: pending.content } : v)));
    setSaveState('saved');
  }

  function handleContentChange(next: string) {
    setDraftContent(next);
    scheduleSave(next);
  }

  function enterEditMode() {
    setMode('edit');
  }

  function exitEditMode() {
    flushPendingSave();
    setMode('preview');
  }

  useEffect(() => {
    if (mode === 'edit') textareaRef.current?.focus();
  }, [mode]);

  const latestVersion = latestOf(versions);
  const isEditable = !!latestVersion && viewedVersionId === latestVersion.id;

  if (versions.length === 0) {
    return (
      <div className="card">
        <p className="text-muted">No versions yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="field-editor-header">
        <span className="field-editor-title">{FIELD_LABELS[field.fieldType]}</span>
      </div>

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
        <button className="btn" onClick={handleSaveAsNewVersion}>
          Save as New Version
        </button>
        {viewedVersionId && versions.length > 1 && (
          <button className="btn btn-danger" onClick={() => handleDeleteVersion(viewedVersionId)}>
            Delete Version
          </button>
        )}
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          className="content-textarea"
          value={draftContent}
          onChange={(e) => isEditable && handleContentChange(e.target.value)}
          onBlur={exitEditMode}
          readOnly={!isEditable}
          placeholder={placeholder}
          spellCheck
        />
      ) : (
        <div className="content-preview" onClick={enterEditMode} tabIndex={0} role="button">
          {draftContent ? (
            <FormattedContent text={draftContent} />
          ) : (
            <span className="content-preview-empty">{placeholder}</span>
          )}
        </div>
      )}
    </div>
  );
}
