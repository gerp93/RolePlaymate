import { useCallback, useEffect, useState } from 'react';
import { Character } from '../../shared/types/character';
import { Lorebook, LorebookEntry } from '../../shared/types/lorebook';
import LoreEntryEditor from '../components/lore/LoreEntryEditor';
import '../components/lore/Lore.css';

/**
 * World lorebooks: shared setting material, attachable to any number of characters.
 *
 * A character's *personal* history book is deliberately not managed here -- it lives on the
 * character, because it is that character's private past rather than shared world-building,
 * and mixing the two lists is how private history ends up attached to the wrong character.
 */
export default function Lorebooks() {
  const [books, setBooks] = useState<Lorebook[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LorebookEntry[]>([]);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [newBookName, setNewBookName] = useState('');
  const [newEntryTitle, setNewEntryTitle] = useState('');

  const selected = books.find((b) => b.id === selectedId) ?? null;

  const refreshBooks = useCallback(async () => {
    setBooks(await window.electronAPI.lorebooks.getWorldBooks());
  }, []);

  const refreshSelected = useCallback(async (bookId: string | null) => {
    if (!bookId) {
      setEntries([]);
      setAttachedIds([]);
      return;
    }
    const [loadedEntries, ids] = await Promise.all([
      window.electronAPI.loreEntries.getByBook(bookId),
      window.electronAPI.lorebooks.getCharacterIds(bookId),
    ]);
    setEntries(loadedEntries);
    setAttachedIds(ids);
  }, []);

  useEffect(() => {
    void (async () => {
      setCharacters(await window.electronAPI.characters.getAll());
      await refreshBooks();
    })();
  }, [refreshBooks]);

  useEffect(() => {
    void refreshSelected(selectedId);
  }, [selectedId, refreshSelected]);

  const createBook = async () => {
    if (!newBookName.trim()) return;
    const book = await window.electronAPI.lorebooks.create({ name: newBookName.trim() });
    setNewBookName('');
    await refreshBooks();
    setSelectedId(book.id);
  };

  const deleteBook = async (id: string) => {
    await window.electronAPI.lorebooks.delete(id);
    if (selectedId === id) setSelectedId(null);
    await refreshBooks();
  };

  const addEntry = async () => {
    if (!selectedId || !newEntryTitle.trim()) return;
    await window.electronAPI.loreEntries.create({
      lorebookId: selectedId,
      title: newEntryTitle.trim(),
    });
    setNewEntryTitle('');
    await refreshSelected(selectedId);
  };

  const toggleAttachment = async (characterId: string, attached: boolean) => {
    if (!selectedId) return;
    if (attached) {
      await window.electronAPI.lorebooks.detach(characterId, selectedId);
    } else {
      await window.electronAPI.lorebooks.attach(characterId, selectedId);
    }
    await refreshSelected(selectedId);
  };

  return (
    <div className="lore-page">
      <aside className="lore-sidebar">
        <div className="lore-sidebar-header">
          <h2>World books</h2>
        </div>
        <ul className="lore-book-list">
          {books.length === 0 && <li className="text-muted">No world books yet.</li>}
          {books.map((book) => (
            <li key={book.id} className={book.id === selectedId ? 'active' : ''}>
              <button type="button" onClick={() => setSelectedId(book.id)}>
                {book.name}
              </button>
              <button
                type="button"
                className="lore-book-delete"
                title="Delete book"
                onClick={() => void deleteBook(book.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="lore-new-book">
          <input
            value={newBookName}
            placeholder="New world book…"
            onChange={(e) => setNewBookName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createBook()}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!newBookName.trim()}
            onClick={() => void createBook()}
          >
            Add
          </button>
        </div>
        <p className="text-muted lore-sidebar-note">
          A character&apos;s own private history lives on the character, not here.
        </p>
      </aside>

      <section className="lore-main">
        {!selected ? (
          <div className="lore-empty">
            <p className="text-muted">
              Select a world book, or create one. Entries are injected into the prompt only when
              one of their trigger keys appears in the recent conversation.
            </p>
          </div>
        ) : (
          <>
            <div className="page-header">
              <h1>{selected.name}</h1>
            </div>

            <div className="card lore-attachments">
              <h2>Used by</h2>
              <p className="text-muted">
                Every character ticked here gets this book&apos;s entries as common knowledge.
              </p>
              <ul className="lore-character-list">
                {characters.length === 0 && <li className="text-muted">No characters yet.</li>}
                {characters.map((character) => {
                  const attached = attachedIds.includes(character.id);
                  return (
                    <li key={character.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={attached}
                          onChange={() => void toggleAttachment(character.id, attached)}
                        />
                        {character.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
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
              {entries.length === 0 && <li className="text-muted">No entries in this book yet.</li>}
              {entries.map((entry) => (
                <LoreEntryEditor
                  key={entry.id}
                  entry={entry}
                  onChanged={() => void refreshSelected(selectedId)}
                  onDeleted={async () => {
                    await window.electronAPI.loreEntries.delete(entry.id);
                    await refreshSelected(selectedId);
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
