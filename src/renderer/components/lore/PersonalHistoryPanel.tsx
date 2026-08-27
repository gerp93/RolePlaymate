import { useCallback, useEffect, useState } from 'react';
import { Lorebook, LorebookEntry } from '../../../shared/types/lorebook';
import LoreEntryEditor from './LoreEntryEditor';
import './Lore.css';

/**
 * A character's own private history, shown on the character rather than on the World books
 * page.
 *
 * These entries reach the model framed as *this character's* memories, explicitly not
 * common knowledge -- other characters don't know them unless this one says so. Keeping the
 * editor here rather than beside the shared world books is the presentation half of that
 * distinction: private history should never look like something you can attach elsewhere.
 */
export default function PersonalHistoryPanel({ characterId }: { characterId: string }) {
  const [book, setBook] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<LorebookEntry[]>([]);
  const [worldBooks, setWorldBooks] = useState<Lorebook[]>([]);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [newTitle, setNewTitle] = useState('');

  const refresh = useCallback(async () => {
    // Creates the personal book on first view rather than alongside every character, so
    // characters that never need one don't accumulate empty books.
    const personal = await window.electronAPI.lorebooks.getPersonalBook(characterId);
    const [loadedEntries, allWorldBooks, forCharacter] = await Promise.all([
      window.electronAPI.loreEntries.getByBook(personal.id),
      window.electronAPI.lorebooks.getWorldBooks(),
      window.electronAPI.lorebooks.getForCharacter(characterId),
    ]);
    setBook(personal);
    setEntries(loadedEntries);
    setWorldBooks(allWorldBooks);
    setAttachedIds(forCharacter.world.map((b) => b.id));
  }, [characterId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addEntry = async () => {
    if (!book || !newTitle.trim()) return;
    await window.electronAPI.loreEntries.create({ lorebookId: book.id, title: newTitle.trim() });
    setNewTitle('');
    await refresh();
  };

  const toggleWorldBook = async (lorebookId: string, attached: boolean) => {
    if (attached) {
      await window.electronAPI.lorebooks.detach(characterId, lorebookId);
    } else {
      await window.electronAPI.lorebooks.attach(characterId, lorebookId);
    }
    await refresh();
  };

  return (
    <div className="card personal-history">
      <div className="lore-entries-header">
        <div>
          <h2>Personal history</h2>
          <p className="text-muted">
            Private memories only this character has. Injected as their own history — other
            characters won&apos;t know them.
          </p>
        </div>
        <div className="lore-new-entry">
          <input
            value={newTitle}
            placeholder="New memory title…"
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addEntry()}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!newTitle.trim()}
            onClick={() => void addEntry()}
          >
            Add
          </button>
        </div>
      </div>

      <ul className="lore-entry-list">
        {entries.length === 0 && (
          <li className="text-muted">
            Nothing yet. Entries fire when one of their trigger keys comes up in conversation.
          </li>
        )}
        {entries.map((entry) => (
          <LoreEntryEditor
            key={entry.id}
            entry={entry}
            onChanged={() => void refresh()}
            onDeleted={async () => {
              await window.electronAPI.loreEntries.delete(entry.id);
              await refresh();
            }}
          />
        ))}
      </ul>

      <div className="personal-history-world">
        <h3>World books this character draws on</h3>
        {worldBooks.length === 0 ? (
          <p className="text-muted">
            No world books yet. Create one from the World Books page, then attach it here.
          </p>
        ) : (
          <ul className="lore-attached-books">
            {worldBooks.map((worldBook) => {
              const attached = attachedIds.includes(worldBook.id);
              return (
                <li key={worldBook.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={attached}
                      onChange={() => void toggleWorldBook(worldBook.id, attached)}
                    />
                    {worldBook.name}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
