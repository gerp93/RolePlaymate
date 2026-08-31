import { useCallback, useEffect, useState } from 'react';
import { Lorebook, LorebookEntry } from '../../../shared/types/lorebook';
import { LOREBOOK_ENTRIES_IMPORT_SAMPLE } from '../../../shared/lorebookImportSample';
import LoreEntryEditor from './LoreEntryEditor';
import LorebookJsonImport from './LorebookJsonImport';
import LimitedInput from '../LimitedInput';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';
import { useSecurity } from '../../context/SecurityContext';
import LockedPlaceholder from '../LockedPlaceholder';
import './Lore.css';

/**
 * A persona's own private history -- the persona equivalent of PersonalHistoryPanel. Also lets
 * a persona attach shared world books, but those only reach this persona's "Suggest reply"
 * draft, not a character's normal reply, unless the character is separately attached too.
 */
export default function PersonaHistoryPanel({ personaId }: { personaId: string }) {
  const { hiddenUnlocked } = useSecurity();
  const [book, setBook] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<LorebookEntry[]>([]);
  const [worldBooks, setWorldBooks] = useState<Lorebook[]>([]);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    const personal = await window.electronAPI.lorebooks.getPersonalBookForPersona(personaId);
    const [loadedEntries, allWorldBooks, forPersona] = await Promise.all([
      window.electronAPI.loreEntries.getByBook(personal.id),
      window.electronAPI.lorebooks.getWorldBooks(),
      window.electronAPI.lorebooks.getForPersona(personaId),
    ]);
    setBook(personal);
    setEntries(loadedEntries);
    setWorldBooks(allWorldBooks);
    setAttachedIds(forPersona.world.map((b) => b.id));
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

  const importJson = async () => {
    if (!book) return;
    setImporting(true);
    try {
      const result = await window.electronAPI.loreEntries.importFromJson(book.id);
      if (!result) return;
      await refresh();
      if (result.warnings.length > 0) {
        alert(`Imported ${result.count} ${result.count === 1 ? 'entry' : 'entries'} with some gaps:\n\n${result.warnings.join('\n')}`);
      }
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const toggleWorldBook = async (lorebookId: string, attached: boolean) => {
    if (attached) {
      await window.electronAPI.lorebooks.detachFromPersona(personaId, lorebookId);
    } else {
      await window.electronAPI.lorebooks.attachToPersona(personaId, lorebookId);
    }
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
          <LimitedInput
            value={newTitle}
            limit={FIELD_LIMITS.name}
            compactCount
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
          <LorebookJsonImport
            importing={importing}
            onImport={() => void importJson()}
            sample={LOREBOOK_ENTRIES_IMPORT_SAMPLE}
          />
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

      <div className="personal-history-world">
        <h3>World books this persona draws on</h3>
        <p className="text-muted">
          Only used to draft this persona&apos;s own &quot;Suggest reply&quot; — the character
          won&apos;t know these unless it&apos;s attached to the same book on its own page.
        </p>
        {worldBooks.length === 0 ? (
          <p className="text-muted">
            No world books yet. Create one from the World Books page, then attach it here.
          </p>
        ) : (
          <ul className="lore-attached-books">
            {worldBooks
              .filter((b) => hiddenUnlocked || !b.isHidden)
              .map((worldBook) => {
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
