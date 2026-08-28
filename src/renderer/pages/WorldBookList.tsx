import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lorebook } from '../../shared/types/lorebook';
import { toImageUrl } from '../utils/imageUrl';
import { useSecurity } from '../context/SecurityContext';

// Same sizing rule as the character grid, so the three library pages read as one family.
function tileMinWidthFor(count: number): number {
  if (count <= 4) return 300;
  if (count <= 8) return 240;
  if (count <= 16) return 200;
  if (count <= 30) return 170;
  return 140;
}

/**
 * World books: shared setting material, attachable to any number of characters (managed per
 * character now, on PersonalHistoryPanel -- see that component for why). This page is just the
 * library: create, clone, delete, open one to edit its entries.
 *
 * A character's own *personal* history book is deliberately never listed here -- it lives on
 * the character, reached through PersonalHistoryPanel, not through this shared-books grid.
 */
export default function WorldBookList() {
  const { hiddenUnlocked } = useSecurity();
  const [books, setBooks] = useState<Lorebook[]>([]);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  // hiddenUnlocked: books already fetched under the previous lock state hold ciphertext for
  // anything hidden -- re-fetch on every lock/unlock so names update immediately instead of
  // only after a manual reload.
  useEffect(() => {
    void load();
  }, [hiddenUnlocked]);

  async function load() {
    setLoading(true);
    setBooks(await window.electronAPI.lorebooks.getWorldBooks());
    setLoading(false);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    setNameError(false);
    await window.electronAPI.lorebooks.create({ name });
    setNewName('');
    await load();
  }

  async function handleImport() {
    setImporting(true);
    try {
      const result = await window.electronAPI.lorebooks.importFromHtml();
      if (!result) return;
      await load();
      if (result.warnings.length > 0) {
        alert(`Imported "${result.lorebook.name}" with some gaps:\n\n${result.warnings.join('\n')}`);
      }
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this world book and all its entries? This cannot be undone.')) return;
    await window.electronAPI.lorebooks.delete(id);
    await load();
  }

  async function handleClone(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.lorebooks.clone(id);
    await load();
  }

  async function handleToggleHidden(e: React.MouseEvent, id: string, hidden: boolean) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.lorebooks.setHidden(id, !hidden);
    await load();
  }

  return (
    <div>
      <div className="page-header">
        <h1>World Books</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (nameError) setNameError(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            placeholder="New world book name"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={() => void handleCreate()}>
            Create World Book
          </button>
          <button className="btn" disabled={importing} onClick={() => void handleImport()}>
            {importing ? 'Importing…' : 'Import from HTML…'}
          </button>
        </div>
        {nameError && <p className="field-error">Enter a name before creating a world book.</p>}
      </div>

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : books.length === 0 ? (
        <div className="text-muted">
          No world books yet -- create one above. Entries are injected into the prompt only
          when one of their trigger keys appears in the recent conversation.
        </div>
      ) : (
        <div
          className="character-grid"
          style={{ '--tile-min-width': `${tileMinWidthFor(books.length)}px` } as React.CSSProperties}
        >
          {books
            .filter((book) => hiddenUnlocked || !book.isHidden)
            .map((book) => (
              <Link key={book.id} to={`/world-books/${book.id}`} className="card character-card">
                <div className="character-card-portrait">
                  {book.image ? <img src={toImageUrl(book.image)} alt={book.name} /> : <span>📖</span>}
                </div>
                <div className="character-card-body">
                  <p className="character-card-name">{book.name}</p>
                  {book.isHidden && <p className="text-muted persona-warning">🔒 Hidden</p>}
                  {book.description && <p className="character-card-snippet">{book.description}</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn"
                      disabled={!book.isHidden && !hiddenUnlocked}
                      title={!book.isHidden && !hiddenUnlocked ? 'Unlock from the topbar to hide items' : undefined}
                      onClick={(e) => void handleToggleHidden(e, book.id, book.isHidden)}
                    >
                      {book.isHidden ? 'Unhide' : 'Hide'}
                    </button>
                    <button className="btn" onClick={(e) => void handleClone(e, book.id)}>
                      Clone
                    </button>
                    <button className="btn btn-danger" onClick={(e) => void handleDelete(e, book.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
