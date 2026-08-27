import { useCallback, useEffect, useState } from 'react';
import { ConversationMemory } from '../../../shared/types/conversationMemory';

interface Props {
  conversationId: string;
  onClose: () => void;
  /** Lets the chat page's badge follow edits made in here, not just extraction. */
  onChanged: () => void;
}

/**
 * What the conversation remembers, and a way to correct it.
 *
 * Extraction is a model call and gets things wrong, so every row is editable and deletable
 * -- a wrong "memory" would otherwise be injected into every later turn with no way to see
 * it, let alone remove it.
 *
 * Manually added memories are stored as 'manual', which pins them: always injected,
 * bypassing both the similarity threshold and the token budget. That is deliberate -- the
 * user asked for them by name.
 */
export default function MemoriesDialog({ conversationId, onClose, onChanged }: Props) {
  const [memories, setMemories] = useState<ConversationMemory[]>([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setMemories(await window.electronAPI.memories.getAll(conversationId));
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The dialog stays open while a turn generates, and extraction can land underneath it.
  useEffect(() => {
    const unsubscribe = window.electronAPI.chat.onMemoriesUpdated((payload) => {
      if (payload.conversationId === conversationId) void load();
    });
    return unsubscribe;
  }, [conversationId, load]);

  const afterChange = async () => {
    await load();
    onChanged();
  };

  const add = async () => {
    if (!draft.trim()) return;
    await window.electronAPI.memories.add(conversationId, draft.trim());
    setDraft('');
    await afterChange();
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (editText.trim()) {
      await window.electronAPI.memories.update(editingId, editText.trim());
    }
    setEditingId(null);
    await afterChange();
  };

  const autoCount = memories.filter((m) => m.source === 'auto').length;

  return (
    <div className="memories-backdrop" role="presentation" onClick={onClose}>
      <div
        className="memories-dialog"
        role="dialog"
        aria-label="Conversation memories"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="memories-header">
          <h2>🧠 Memories</h2>
          <span className="text-muted">
            {memories.length === 0
              ? 'nothing remembered yet'
              : `${memories.length - autoCount} pinned · ${autoCount} extracted`}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="memories-note text-muted">
          Facts carried into later turns without resending the whole transcript. Pinned ones
          are always injected; extracted ones only when they match what&apos;s being said.
        </p>

        <div className="memories-add">
          <input
            value={draft}
            placeholder="Add something the character should always remember"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
          />
          <button type="button" className="btn btn-primary" disabled={!draft.trim()} onClick={() => void add()}>
            Add
          </button>
        </div>

        {memories.length === 0 ? (
          <p className="memories-empty text-muted">
            Memories are extracted automatically after each turn, once there is something
            worth keeping. You can also pin one above.
          </p>
        ) : (
          <ul className="memories-list">
            {memories.map((memory) => (
              <li key={memory.id} className={`memory-row memory-${memory.source}`}>
                {editingId === memory.id ? (
                  <>
                    <textarea
                      rows={2}
                      value={editText}
                      autoFocus
                      onChange={(e) => setEditText(e.target.value)}
                    />
                    <button type="button" className="btn" onClick={() => void saveEdit()}>
                      Save
                    </button>
                    <button type="button" className="btn" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="memory-marker" title={memory.source === 'manual' ? 'Pinned — always injected' : 'Extracted after a turn'}>
                      {memory.source === 'manual' ? '📌' : '·'}
                    </span>
                    <span className="memory-text">{memory.content}</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setEditingId(memory.id);
                        setEditText(memory.content);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={async () => {
                        await window.electronAPI.memories.delete(memory.id);
                        await afterChange();
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {memories.length > 0 && (
          <footer className="memories-footer">
            {confirmClear ? (
              <>
                <span>Delete all {memories.length}? This can&apos;t be undone.</span>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    await window.electronAPI.memories.deleteAll(conversationId);
                    setConfirmClear(false);
                    await afterChange();
                  }}
                >
                  Delete all
                </button>
                <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                  Keep them
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmClear(true)}>
                Delete all memories
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
