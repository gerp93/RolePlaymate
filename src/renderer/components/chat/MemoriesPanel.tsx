import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConversationMemory } from '../../../shared/types/conversationMemory';
import LimitedInput from '../LimitedInput';
import LimitedTextarea from '../LimitedTextarea';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';
import { OLLAMA_MEMORIES_STEP_INDEX } from '../../guides/ollamaSetupTrack';

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
  const [embeddingMissing, setEmbeddingMissing] = useState(false);
  const [embeddingModelName, setEmbeddingModelName] = useState('nomic-embed-text');

  const load = useCallback(async () => {
    setMemories(await window.electronAPI.memories.getAll(conversationId));
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.ollama.getEmbeddingModelStatus().then((status) => {
      if (!cancelled) {
        setEmbeddingModelName(status.model);
        setEmbeddingMissing(status.ollamaReachable && !status.installed);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const togglePin = async (memory: ConversationMemory) => {
    await window.electronAPI.memories.setPinned(memory.id, memory.source !== 'manual');
    await afterChange();
  };

  const autoCount = memories.filter((m) => m.source === 'auto').length;

  return (
    <div className="memories-panel">
      {embeddingMissing && (
        <p className="memories-embedding-notice">
          The {embeddingModelName} embedding model is missing from Ollama, so extracted
          memories below aren&apos;t matched by meaning. Pin the ones you always want included.{' '}
          <Link
            to="/about"
            state={{ trackId: 'ollama-setup', stepIndex: OLLAMA_MEMORIES_STEP_INDEX }}
            className="memories-embedding-notice-link"
          >
            Learn more
          </Link>
        </p>
      )}

      <div className="memories-header">
        <p className="memories-summary text-muted">
          {memories.length === 0
            ? 'Nothing remembered yet'
            : `${memories.length - autoCount} pinned · ${autoCount} extracted`}
        </p>
        {memories.length > 0 &&
          (confirmClear ? (
            <div className="memories-clear-confirm">
              <span>Delete all {memories.length}?</span>
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
            </div>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmClear(true)}>
              Delete all memories
            </button>
          ))}
      </div>

      <p className="memories-note text-muted">
        Facts carried into later turns without resending the whole transcript. Pinned ones are
        always injected; extracted ones only when they match what&apos;s being said.
      </p>

      <div className="memories-add">
        <LimitedInput
          value={draft}
          limit={FIELD_LIMITS.memory}
          compactCount
          placeholder="Add a character memory for this chat instance"
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
                    className="btn memory-icon-btn"
                    title={memory.source === 'manual' ? 'Unpin' : 'Pin'}
                    aria-label={memory.source === 'manual' ? 'Unpin' : 'Pin'}
                    onClick={() => void togglePin(memory)}
                  >
                    📌
                  </button>
                  <button
                    type="button"
                    className="btn memory-icon-btn"
                    title="Edit"
                    aria-label="Edit"
                    onClick={() => {
                      setEditingId(memory.id);
                      setEditText(memory.content);
                    }}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger memory-icon-btn"
                    title="Delete"
                    aria-label="Delete"
                    onClick={async () => {
                      await window.electronAPI.memories.delete(memory.id);
                      await afterChange();
                    }}
                  >
                    🗑️
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
