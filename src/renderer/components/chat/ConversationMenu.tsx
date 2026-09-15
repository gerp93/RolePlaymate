import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Same character/persona/scenario/model/image picks as this conversation, no transcript --
   * a fresh start, not a copy of the conversation itself. */
  onDuplicate: () => void;
  /** Same settings, plus the full transcript/variants/memories copied so far. */
  onBranch: () => void;
}

/** Small "⋯" menu sitting above the transcript -- the closest thing this page has to a
 * persistent per-conversation toolbar (the scenario header disappears with no scenario
 * selected, and the sidebar reveal buttons disappear once their sidebar is open), so it's
 * always available whenever a conversation is open. Same open/outside-click pattern as
 * ImagePickerSelect. */
export default function ConversationMenu({ onDuplicate, onBranch }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div className="chat-conversation-menu" ref={rootRef}>
      <button
        type="button"
        className="chat-conversation-menu-trigger"
        title="Conversation options"
        aria-label="Conversation options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="chat-conversation-menu-panel">
          <button
            type="button"
            className="chat-conversation-menu-item"
            onClick={() => {
              setOpen(false);
              onDuplicate();
            }}
          >
            Duplicate as new chat
          </button>
          <button
            type="button"
            className="chat-conversation-menu-item"
            onClick={() => {
              setOpen(false);
              onBranch();
            }}
          >
            Branch from here
          </button>
        </div>
      )}
    </div>
  );
}
