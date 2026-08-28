import { useCallback, useEffect, useState } from 'react';
import { ConversationMemory } from '../../../shared/types/conversationMemory';
import LimitedInput from '../LimitedInput';
import LimitedTextarea from '../LimitedTextarea';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';

interface Props {
  conversationId: string;
  /** Lets the chat page's badge follow edits made in here, not just extraction. */
  onChanged: () => void;
}

/**
 * Conversation memories editor -- embedded in the right sidebar's Memories tab (see
 * ChatRightSidebar). Extraction is a model call and gets things wrong, so every row is
 * editable and deletable; manually added ones are stored as 'manual' and pinned (always
 * injected, bypassing similarity threshold and token budget).
 */
export default function MemoriesPanel({ conversationId, onChanged }: Props) {
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
    <div className="memories-panel">
      <p className="memories-summary text-muted">
        {memories.length === 0
          ? 'Nothing remembered yet'
          : `${memories.length - autoCount} pinned · ${autoCount} extracted`}
      </p>

      <p className="memories-note text-muted">
        Facts carried into later turns without resending the whole transcript. Pinned ones are
        always injected; extracted ones only when they match what&apos;s being said.
      </p>

      <div className="memories-add">
        <LimitedInput
          value={draft}
          limit={FIELD_LIMITS.memory}
          compactCount
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
          Memories are extracted automatically after each turn, once there is something worth
          keeping. You can also pin one above.
        </p>
      ) : (
        <ul className="memories-list">
          {memories.map((memory) => (
            <li key={memory.id} className={`memory-row memory-${memory.source}`}>
              {editingId === memory.id ? (
                <>
                  <LimitedTextarea
                    rows={2}
                    limit={FIELD_LIMITS.memory}
                    compactCount
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
                  <span
                    className="memory-marker"
                    title={memory.source === 'manual' ? 'Pinned — always injected' : 'Extracted after a turn'}
                  >
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
  );
}
