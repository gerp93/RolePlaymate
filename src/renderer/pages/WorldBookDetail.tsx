import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Lorebook, LorebookEntry } from '../../shared/types/lorebook';
import { LOREBOOK_ENTRIES_IMPORT_SAMPLE } from '../../shared/lorebookImportSample';
import LoreEntryEditor from '../components/lore/LoreEntryEditor';
import LorebookJsonImport from '../components/lore/LorebookJsonImport';
import { toImageUrl } from '../utils/imageUrl';
import { useSecurity } from '../context/SecurityContext';
import LockedPlaceholder from '../components/LockedPlaceholder';
import LimitedInput from '../components/LimitedInput';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import '../components/lore/Lore.css';

export default function WorldBookDetail() {
  const { lorebookId } = useParams<{ lorebookId: string }>();
  const navigate = useNavigate();
  const { hiddenUnlocked } = useSecurity();
  const [book, setBook] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<LorebookEntry[]>([]);
  const [otherWorldBooks, setOtherWorldBooks] = useState<Lorebook[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [newEntryTitle, setNewEntryTitle] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveTarget, setBulkMoveTarget] = useState('');

  const load = useCallback(async () => {
    if (!lorebookId) return;
    const [loadedBook, loadedEntries, allWorldBooks] = await Promise.all([
      window.electronAPI.lorebooks.getById(lorebookId),
      window.electronAPI.loreEntries.getByBook(lorebookId),
      window.electronAPI.lorebooks.getWorldBooks(),
    ]);
    if (!loadedBook) {
      navigate('/world-books');
      return;
    }
    setBook(loadedBook);
    setNameDraft(loadedBook.name);
    setDescriptionDraft(loadedBook.description ?? '');
    setEntries(loadedEntries);
    setOtherWorldBooks(allWorldBooks.filter((b) => b.id !== lorebookId));
    setSelectedIds(new Set());
  }, [lorebookId, navigate]);

  // hiddenUnlocked: load() already ran under the previous lock state holds ciphertext when
  // this book is hidden -- re-fetch on every lock/unlock so content updates immediately
  // instead of only after a manual reload.
  useEffect(() => {
    void load();
  }, [load, hiddenUnlocked]);

  async function handleNameBlur() {
    if (!lorebookId || !book) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== book.name) {
      await window.electronAPI.lorebooks.update(lorebookId, { name: trimmed });
      await load();
    }
  }

  async function handleDescriptionBlur() {
    if (!lorebookId || !book) return;
    if (descriptionDraft !== (book.description ?? '')) {
      await window.electronAPI.lorebooks.update(lorebookId, { description: descriptionDraft });
      await load();
    }
  }

  async function handleChooseImage() {
    if (!lorebookId) return;
    setImageBusy(true);
    try {
      const path = await window.electronAPI.lorebooks.chooseImage();
      if (path) {
        await window.electronAPI.lorebooks.update(lorebookId, { image: path });
        await load();
      }
    } finally {
      setImageBusy(false);
    }
  }

  const addEntry = async () => {
    if (!lorebookId || !newEntryTitle.trim()) return;
    await window.electronAPI.loreEntries.create({ lorebookId, title: newEntryTitle.trim() });
    setNewEntryTitle('');
    await load();
  };

  const importJson = async () => {
    if (!lorebookId) return;
    setImporting(true);
    try {
      const result = await window.electronAPI.loreEntries.importFromJson(lorebookId);
      if (!result) return;
      await load();
      if (result.warnings.length > 0) {
        alert(`Imported ${result.count} ${result.count === 1 ? 'entry' : 'entries'} with some gaps:\n\n${result.warnings.join('\n')}`);
      }
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const toggleSelected = (entryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const moveEntry = async (entryId: string, targetLorebookId: string) => {
    try {
      await window.electronAPI.loreEntries.move(entryId, targetLorebookId);
      await load();
    } catch (err) {
      alert(`Move failed: ${(err as Error).message}`);
    }
  };

  const moveSelected = async () => {
    if (!bulkMoveTarget || selectedIds.size === 0) return;
    try {
      await window.electronAPI.loreEntries.moveMany(Array.from(selectedIds), bulkMoveTarget);
      setBulkMoveTarget('');
      await load();
    } catch (err) {
      alert(`Move failed: ${(err as Error).message}`);
    }
  };

  const visibleMoveTargets = otherWorldBooks.filter((b) => hiddenUnlocked || !b.isHidden);

  if (!book) return <div className="text-muted">Loading…</div>;
  if (book.isHidden && !hiddenUnlocked) return <LockedPlaceholder label="This world book" />;

  return (
    <div className="character-detail-page">
      <div className="character-detail-fields">
        <Link to="/world-books" className="text-muted" style={{ fontSize: 13 }}>
          ‹ World Books
        </Link>

        <div className="page-header">
          <LimitedInput
            value={nameDraft}
            limit={FIELD_LIMITS.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameBlur}
            style={{
              fontSize: 22,
              fontWeight: 700,
              border: 'none',
              background: 'transparent',
              padding: '4px 0',
            }}
          />
          <LimitedInput
            value={descriptionDraft}
            limit={FIELD_LIMITS.short}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="Short description..."
            className="text-muted"
            style={{
              fontSize: 14,
              border: 'none',
              background: 'transparent',
              padding: '2px 0 4px',
            }}
          />
        </div>

        <div className="lore-entries-header">
          <h2>Entries</h2>
          <div className="lore-new-entry">
            <LimitedInput
              value={newEntryTitle}
              limit={FIELD_LIMITS.name}
              compactCount
              placeholder="New entry title…"
              onChange={(e) => setNewEntryTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addEntry()}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!newEntryTitle.trim()}
              onClick={() => void addEntry()}
            >
              Add entry
            </button>
            <LorebookJsonImport
              importing={importing}
              onImport={() => void importJson()}
              sample={LOREBOOK_ENTRIES_IMPORT_SAMPLE}
            />
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="lore-bulk-actions">
            <span>{selectedIds.size} selected</span>
            <select
              value={bulkMoveTarget}
              onChange={(e) => setBulkMoveTarget(e.target.value)}
              disabled={visibleMoveTargets.length === 0}
            >
              <option value="">Move to…</option>
              {visibleMoveTargets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" disabled={!bulkMoveTarget} onClick={() => void moveSelected()}>
              Move
            </button>
            <button type="button" className="btn" onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </button>
          </div>
        )}

        <ul className="lore-entry-list">
          {entries.length === 0 && (
            <li className="text-muted">
              No entries yet. Entries are injected into the prompt only when one of their
              trigger keys appears in the recent conversation.
            </li>
          )}
          {entries.map((entry) => (
            // Keyed on hiddenUnlocked too -- LoreEntryEditor fetches its own version history
            // once per mount, so it needs to remount (and re-fetch) on lock/unlock the same as
            // load() above, or its already-fetched content would stay stale ciphertext.
            <LoreEntryEditor
              key={`${entry.id}-${hiddenUnlocked}`}
              entry={entry}
              onChanged={() => void load()}
              onDeleted={async () => {
                await window.electronAPI.loreEntries.delete(entry.id);
                await load();
              }}
              selected={selectedIds.has(entry.id)}
              onToggleSelected={toggleSelected}
              moveTargets={visibleMoveTargets}
              onMove={moveEntry}
            />
          ))}
        </ul>
      </div>

      <div className="character-detail-portrait-panel">
        <div className="character-detail-portrait-large">
          {book.image ? <img src={toImageUrl(book.image)} alt={book.name} /> : <span>📖</span>}
        </div>
        <button className="btn" disabled={imageBusy} onClick={() => void handleChooseImage()}>
          {imageBusy ? 'Choosing…' : book.image ? 'Change Image…' : 'Add Image…'}
        </button>
      </div>
    </div>
  );
}
