import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lorebook } from '../../shared/types/lorebook';
import { toImageUrl } from '../utils/imageUrl';

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
  const [books, setBooks] = useState<Lorebook[]>([]);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

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
          {books.map((book) => (
            <Link key={book.id} to={`/world-books/${book.id}`} className="card character-card">
              <div className="character-card-portrait">
                {book.image ? <img src={toImageUrl(book.image)} alt={book.name} /> : <span>📖</span>}
              </div>
              <div className="character-card-body">
                <p className="character-card-name">{book.name}</p>
                {book.description && <p className="character-card-snippet">{book.description}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
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
