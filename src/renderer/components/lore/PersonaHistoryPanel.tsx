import { useCallback, useEffect, useState } from 'react';
import { Lorebook, LorebookEntry } from '../../../shared/types/lorebook';
import LoreEntryEditor from './LoreEntryEditor';
import './Lore.css';

/**
 * A persona's own private history -- the persona equivalent of PersonalHistoryPanel. No
 * world-book section here: personas don't attach to shared world books (only characters do),
 * so there is nothing to show beyond this persona's own memories.
 */
export default function PersonaHistoryPanel({ personaId }: { personaId: string }) {
  const [book, setBook] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<LorebookEntry[]>([]);
  const [newTitle, setNewTitle] = useState('');

  const refresh = useCallback(async () => {
    const personal = await window.electronAPI.lorebooks.getPersonalBookForPersona(personaId);
    const loadedEntries = await window.electronAPI.loreEntries.getByBook(personal.id);
    setBook(personal);
    setEntries(loadedEntries);
  }, [personaId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addEntry = async () => {
    if (!book || !newTitle.trim()) return;
    await window.electronAPI.loreEntries.create({ lorebookId: book.id, title: newTitle.trim() });
    setNewTitle('');
    await refresh();
  };

  return (
    <div className="card personal-history">
      <div className="lore-entries-header">
        <div>
          <h2>Personal history</h2>
          <p className="text-muted">
            Private memories only this persona has. Injected when this persona is playing --
            characters won&apos;t know them unless the persona says so.
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
    </div>
  );
}
