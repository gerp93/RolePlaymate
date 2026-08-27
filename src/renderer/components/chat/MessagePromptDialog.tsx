import { ChatDebugInfo } from '../../../shared/types/chat';
import DebugConsole from './DebugConsole';

/**
 * The logged prompt for one specific message, opened from its hover tooltip. Reuses the same
 * DebugConsole the live sidebar panel uses -- it's the same data shape, just historical
 * (read from message_variants.debug) instead of the just-finished turn.
 */
export default function MessagePromptDialog({
  debug,
  onClose,
}: {
  debug: ChatDebugInfo | null;
  onClose: () => void;
}) {
  return (
    <div className="memories-backdrop" role="presentation" onClick={onClose}>
      <div
        className="memories-dialog"
        role="dialog"
        aria-label="Logged prompt"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="memories-header">
          <h2>🔍 Logged Prompt</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>
        <DebugConsole debug={debug} />
      </div>
    </div>
  );
}
