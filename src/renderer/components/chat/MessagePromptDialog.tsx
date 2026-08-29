import { ChatDebugInfo } from '../../../shared/types/chat';
import { buildDebugTurnExport } from '../../utils/debugExport';
import DebugConsole, { CopyButton } from './DebugConsole';

function hasUsableDebug(debug: ChatDebugInfo | null): debug is ChatDebugInfo {
  if (!debug) return false;
  return !!(
    debug.fullPrompt?.trim() ||
    debug.systemPrompt?.trim() ||
    debug.baseSystemPrompt?.trim()
  );
}

/**
 * The logged prompt for one specific message, opened from its hover tooltip. Reuses the same
 * DebugConsole the live sidebar panel uses -- it's the same data shape, just historical
 * (read from message_variants.debug) instead of the just-finished turn.
 *
 * This dialog only ever holds one message's debug record (not the conversation's full
 * history -- that's the sidebar's Prompt Debugging pane), so its copy button copies that one
 * turn's full prompt rather than an export of every turn.
 */
export default function MessagePromptDialog({
  debug,
  loading,
  onClose,
}: {
  debug: ChatDebugInfo | null;
  loading: boolean;
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
        <button
          type="button"
          className="chat-sidebar-collapse-btn message-prompt-dialog-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <header className="memories-header">
          <h2>🔍 Logged Prompt</h2>
          {hasUsableDebug(debug) && (
            <CopyButton value={buildDebugTurnExport(debug)} label="Copy full prompt" />
          )}
        </header>
        <div className="message-prompt-dialog-debug">
          {loading ? (
            <div className="debug-console debug-console-loading">
              <span className="btn-spinner" aria-hidden />
            </div>
          ) : hasUsableDebug(debug) ? (
            <DebugConsole debug={debug} showHeader={false} />
          ) : (
            <div className="debug-console">
              <p className="debug-console-placeholder">
                No prompt was logged for this message — only model-generated replies store
                debug info.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
