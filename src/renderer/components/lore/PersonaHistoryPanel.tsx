import { useCallback, useEffect, useState } from 'react';
import { Lorebook, LorebookEntry } from '../../../shared/types/lorebook';
import LoreEntryEditor from './LoreEntryEditor';
import { useSecurity } from '../../context/SecurityContext';
import LockedPlaceholder from '../LockedPlaceholder';
import './Lore.css';

/**
 * A persona's own private history -- the persona equivalent of PersonalHistoryPanel. No
 * world-book section here: personas don't attach to shared world books (only characters do),
 * so there is nothing to show beyond this persona's own memories.
 */
export default function PersonaHistoryPanel({ personaId }: { personaId: string }) {
  const { hiddenUnlocked } = useSecurity();
  const [book, setBook] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<LorebookEntry[]>([]);
  const [newTitle, setNewTitle] = useState('');

  const refresh = useCallback(async () => {
    const personal = await window.electronAPI.lorebooks.getPersonalBookForPersona(personaId);
    const loadedEntries = await window.electronAPI.loreEntries.getByBook(personal.id);
    setBook(personal);
    setEntries(loadedEntries);
  }, [personaId]);

  // hiddenUnlocked: refresh() already ran under the previous lock state hold ciphertext when
  // this persona's book is hidden -- re-fetch on every lock/unlock so content updates
  // immediately instead of only after a manual reload.
  useEffect(() => {
    void refresh();
  }, [refresh, hiddenUnlocked]);

  const addEntry = async () => {
    if (!book || !newTitle.trim()) return;
    await window.electronAPI.loreEntries.create({ lorebookId: book.id, title: newTitle.trim() });
    setNewTitle('');
    await refresh();
  };

  // A persona can be visible while its own personal lorebook is separately hidden -- same
  // independent guard as PersonalHistoryPanel.
  if (book?.isHidden && !hiddenUnlocked) {
    return <LockedPlaceholder label="This persona's personal history" />;
  }

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
          // Keyed on hiddenUnlocked too -- LoreEntryEditor fetches its own version history once
          // per mount, so it needs to remount (and re-fetch) on lock/unlock the same as refresh()
          // above, or its already-fetched content would stay stale ciphertext.
          <LoreEntryEditor
            key={`${entry.id}-${hiddenUnlocked}`}
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
