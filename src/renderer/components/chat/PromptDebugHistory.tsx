import { useEffect, useState } from 'react';
import { ChatDebugHistoryEntry, ChatDebugInfo } from '../../../shared/types/chat';
import { buildDebugTurnExport } from '../../utils/debugExport';
import DebugConsole, { CopyButton } from './DebugConsole';

function mergeLiveDebug(
  history: ChatDebugHistoryEntry[],
  liveDebug: ChatDebugInfo | null,
  liveMessageId: string | null,
  liveCreatedAt: string | null
): ChatDebugHistoryEntry[] {
  if (!liveDebug || !liveMessageId) return history;
  if (history.some((entry) => entry.messageId === liveMessageId)) return history;
  return [
    ...history,
    {
      messageId: liveMessageId,
      createdAt: liveCreatedAt ?? new Date().toISOString(),
      debug: liveDebug,
    },
  ];
}

/**
 * The Prompt Debugging pane's history view: every turn this conversation has ever sent,
 * newest first, each collapsible -- only the most recently completed turn starts expanded.
 * Older turns stay exactly as they were logged even after later edits/redos change what the
 * character "remembers", which is the point: this is a record of what was actually sent, not
 * a live reflection of the current prompt.
 */
export default function PromptDebugHistory({
  conversationId,
  history,
  historyLoading,
  liveDebug,
  liveMessageId,
  liveCreatedAt,
  isGenerating,
}: {
  conversationId: string;
  history: ChatDebugHistoryEntry[];
  historyLoading: boolean;
  liveDebug: ChatDebugInfo | null;
  liveMessageId: string | null;
  liveCreatedAt: string | null;
  isGenerating: boolean;
}) {
  const chronological = mergeLiveDebug(history, liveDebug, liveMessageId, liveCreatedAt);
  const displayHistory = chronological.map((entry, index) => ({ ...entry, turnNumber: index + 1 })).reverse();
  const newestMessageId = displayHistory[0]?.messageId ?? null;

  const [openMessageId, setOpenMessageId] = useState<string | null>(null);

  // Expand only the newest turn (top of the list) when the conversation loads or a new turn
  // lands. Older turns stay collapsed unless the user opens one manually.
  useEffect(() => {
    setOpenMessageId(newestMessageId);
  }, [conversationId, newestMessageId]);

  if (historyLoading && displayHistory.length === 0 && !isGenerating) {
    return (
      <div className="debug-console debug-console-loading">
        <span className="btn-spinner" aria-hidden />
      </div>
    );
  }

  if (displayHistory.length === 0 && !isGenerating) {
    return (
      <div className="debug-console">
        <div className="debug-console-header">
          <span className="debug-console-title">🔍 Prompt Debug Console</span>
        </div>
        <p className="debug-console-placeholder">
          Send a message to see the prompt debug info here.
        </p>
      </div>
    );
  }

  return (
    <div className="prompt-debug-history">
      {displayHistory.length > 0 && (
        <div className="prompt-debug-history-header">
          <span className="prompt-debug-history-count">
            {displayHistory.length} {displayHistory.length === 1 ? 'turn' : 'turns'} logged
          </span>
          <CopyButton value={buildHistoryExportText(chronological)} label="Copy entire prompt history" />
        </div>
      )}

      {isGenerating && (
        <div className="prompt-debug-history-pending">
          <span className="btn-spinner" aria-hidden />
          Generating reply…
        </div>
      )}

      {displayHistory.map((entry) => (
        <details
          key={entry.messageId}
          className="prompt-debug-history-entry"
          open={openMessageId === entry.messageId}
        >
          <summary
            className="prompt-debug-history-summary"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('button')) {
                event.preventDefault();
                return;
              }
              event.preventDefault();
              setOpenMessageId((current) =>
                current === entry.messageId ? null : entry.messageId
              );
            }}
          >
            <span className="prompt-debug-history-turn">Turn {entry.turnNumber}</span>
            <span className="prompt-debug-history-time">{formatTimestamp(entry.createdAt)}</span>
            <span className="prompt-debug-history-preview">{previewFor(entry)}</span>
            <span className="prompt-debug-history-copy">
              <CopyButton
                value={buildDebugTurnExport(entry.debug, {
                  turnNumber: entry.turnNumber,
                  createdAt: entry.createdAt,
                })}
                label={`Copy turn ${entry.turnNumber} prompt`}
              />
            </span>
          </summary>
          <div className="prompt-debug-history-body">
            <DebugConsole debug={entry.debug} showHeader={false} />
          </div>
        </details>
      ))}
    </div>
  );
}

function previewFor(entry: ChatDebugHistoryEntry): string {
  const text = entry.debug.userMessage?.trim();
  return truncate(text || '(continued, no new user message)', 64);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildHistoryExportText(history: ChatDebugHistoryEntry[]): string {
  return history
    .map((entry, index) =>
      buildDebugTurnExport(entry.debug, { turnNumber: index + 1, createdAt: entry.createdAt })
    )
    .join('\n\n');
}
