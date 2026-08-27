import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Lorebook, LorebookEntry } from '../../shared/types/lorebook';
import LoreEntryEditor from '../components/lore/LoreEntryEditor';
import { toImageUrl } from '../utils/imageUrl';
import '../components/lore/Lore.css';

export default function WorldBookDetail() {
  const { lorebookId } = useParams<{ lorebookId: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<LorebookEntry[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [newEntryTitle, setNewEntryTitle] = useState('');
  const [imageBusy, setImageBusy] = useState(false);

  const load = useCallback(async () => {
    if (!lorebookId) return;
    const [loadedBook, loadedEntries] = await Promise.all([
      window.electronAPI.lorebooks.getById(lorebookId),
      window.electronAPI.loreEntries.getByBook(lorebookId),
    ]);
    if (!loadedBook) {
      navigate('/world-books');
      return;
    }
    setBook(loadedBook);
    setNameDraft(loadedBook.name);
    setDescriptionDraft(loadedBook.description ?? '');
    setEntries(loadedEntries);
  }, [lorebookId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (!book) return <div className="text-muted">Loading…</div>;

  return (
    <div className="character-detail-page">
      <div className="character-detail-fields">
        <Link to="/world-books" className="text-muted" style={{ fontSize: 13 }}>
          ‹ World Books
        </Link>

        <div className="page-header">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameBlur}
            style={{
              fontSize: 22,
              fontWeight: 700,
              border: 'none',
              background: 'transparent',
              padding: '4px 0',
              width: '100%',
            }}
          />
          <input
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="Short description..."
            className="text-muted"
            style={{
              fontSize: 14,
              border: 'none',
              background: 'transparent',
              padding: '2px 0 4px',
              width: '100%',
            }}
          />
        </div>

        <div className="lore-entries-header">
          <h2>Entries</h2>
          <div className="lore-new-entry">
            <input
              value={newEntryTitle}
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
          </div>
        </div>

        <ul className="lore-entry-list">
          {entries.length === 0 && (
            <li className="text-muted">
              No entries yet. Entries are injected into the prompt only when one of their
              trigger keys appears in the recent conversation.
            </li>
          )}
          {entries.map((entry) => (
            <LoreEntryEditor
              key={entry.id}
              entry={entry}
              onChanged={() => void load()}
              onDeleted={async () => {
                await window.electronAPI.loreEntries.delete(entry.id);
                await load();
              }}
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
