import { ChatDebugHistoryEntry, ChatDebugInfo } from '../../../shared/types/chat';
import PromptDebugHistory from './PromptDebugHistory';
import MemoriesPanel from './MemoriesPanel';

export type RightSidebarTab = 'memories' | 'debug';

interface Props {
  tab: RightSidebarTab;
  onTabChange: (tab: RightSidebarTab) => void;
  onClose: () => void;
  conversationId: string;
  memoryCount: number;
  debugHistory: ChatDebugHistoryEntry[];
  debugHistoryLoading: boolean;
  liveDebug: ChatDebugInfo | null;
  liveMessageId: string | null;
  liveCreatedAt: string | null;
  isGenerating: boolean;
  onMemoriesChanged: () => void;
}

/** Right-hand sidebar: Memories and Prompt Debug share one opener and one column. */
export default function ChatRightSidebar({
  tab,
  onTabChange,
  onClose,
  conversationId,
  memoryCount,
  debugHistory,
  debugHistoryLoading,
  liveDebug,
  liveMessageId,
  liveCreatedAt,
  isGenerating,
  onMemoriesChanged,
}: Props) {
  return (
    <aside className="chat-right-sidebar" aria-label="Conversation tools">
      <div className="chat-right-sidebar-header">
        <div className="chat-right-sidebar-tabs" role="tablist" aria-label="Sidebar panels">
          <button
            type="button"
            role="tab"
            id="chat-right-tab-memories"
            aria-selected={tab === 'memories'}
            aria-controls="chat-right-panel-memories"
            className={`chat-right-sidebar-tab${tab === 'memories' ? ' active' : ''}`}
            onClick={() => onTabChange('memories')}
          >
            🧠 Memories
            {memoryCount > 0 && <span className="chat-memory-badge">{memoryCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            id="chat-right-tab-debug"
            aria-selected={tab === 'debug'}
            aria-controls="chat-right-panel-debug"
            className={`chat-right-sidebar-tab${tab === 'debug' ? ' active' : ''}`}
            onClick={() => onTabChange('debug')}
          >
            🐛 Prompt Debugging
          </button>
        </div>
        <button
          type="button"
          className="chat-sidebar-collapse-btn"
          aria-label="Hide sidebar"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="chat-right-sidebar-body">
        {tab === 'memories' ? (
          <div
            role="tabpanel"
            id="chat-right-panel-memories"
            aria-labelledby="chat-right-tab-memories"
            className="chat-right-sidebar-panel"
          >
            <MemoriesPanel conversationId={conversationId} onChanged={onMemoriesChanged} />
          </div>
        ) : (
          <div
            role="tabpanel"
            id="chat-right-panel-debug"
            aria-labelledby="chat-right-tab-debug"
            className="chat-right-sidebar-panel chat-right-sidebar-panel-debug"
          >
            <PromptDebugHistory
              conversationId={conversationId}
              history={debugHistory}
              historyLoading={debugHistoryLoading}
              liveDebug={liveDebug}
              liveMessageId={liveMessageId}
              liveCreatedAt={liveCreatedAt}
              isGenerating={isGenerating}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
