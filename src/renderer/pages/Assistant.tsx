import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AssistantConversation,
  AssistantMessage,
  AssistantProposal,
  AssistantSettings,
  AssistantStreamEvent,
  DEFAULT_ASSISTANT_CONTEXT_WINDOW,
} from '../../shared/types/assistant';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { OllamaModelInfo } from '../../shared/types/ollama';
import { useSecurity } from '../context/SecurityContext';
import OllamaRequiredGate from '../components/chat/OllamaRequiredGate';
import LimitedTextarea from '../components/LimitedTextarea';
import AssistantTranscript from '../components/assistant/AssistantTranscript';
import AssistantContextPanel from '../components/assistant/AssistantContextPanel';
import { describeToolCall } from '../components/assistant/describeToolCall';
import '../components/assistant/Assistant.css';

const STARTERS = [
  'Help me brainstorm a new character',
  'Help me write a scenario for one of my characters',
  'Look through my library for duplicates',
  'Check my characters for contradictions',
];

const DEFAULT_SETTINGS: AssistantSettings = { model: '', contextWindow: DEFAULT_ASSISTANT_CONTEXT_WINDOW, styleGuide: '' };

function AssistantInner() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { hiddenUnlocked } = useSecurity();

  const [settings, setSettings] = useState<AssistantSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<OllamaModelInfo[]>([]);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [conversation, setConversation] = useState<AssistantConversation | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const [running, setRunning] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [contextOpen, setContextOpen] = useState(true);

  // The stream listener is attached once, so it reads the current conversation through a ref.
  const activeId = useRef<string | null>(null);
  activeId.current = conversation?.id ?? null;
  // A conversation this page just created is already in state; reloading it as the route changes could
  // overwrite a run that has begun by then.
  const justCreated = useRef<string | null>(null);

  const refreshList = useCallback(async () => {
    setConversations(await window.electronAPI.assistant.listConversations());
  }, []);

  const load = useCallback(async (id: string) => {
    try {
      const data = await window.electronAPI.assistant.getConversation(id);
      setConversation(data.conversation);
      setMessages(data.messages);
      setProposals(data.proposals);
      setRunning(data.running);
      setLiveText('');
      setStatus('');
      setError(null);
    } catch {
      // Gone, or hidden again since the link was made.
      setConversation(null);
      setMessages([]);
      setProposals([]);
      setRunning(false);
      navigate('/assistant', { replace: true });
    }
  }, [navigate]);

  // One-time setup, plus a refresh whenever the PIN lock changes (conversations that showed hidden
  // content appear and disappear with it).
  useEffect(() => {
    void window.electronAPI.assistant.getSettings().then(setSettings);
    void window.electronAPI.ollama.listModelsDetailed().then((r) => setModels(r.models));
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList, hiddenUnlocked]);

  useEffect(() => {
    if (conversationId && justCreated.current === conversationId) {
      justCreated.current = null;
      return;
    }
    if (conversationId) void load(conversationId);
    else {
      setConversation(null);
      setMessages([]);
      setProposals([]);
      setRunning(false);
      setLiveText('');
    }
  }, [conversationId, load, hiddenUnlocked]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.assistant.onStream((event: AssistantStreamEvent) => {
      const mine = event.conversationId === activeId.current;
      const terminal = event.type === 'done' || event.type === 'error' || event.type === 'cancelled';
      if (terminal) void refreshList();
      if (!mine) return;

      switch (event.type) {
        case 'token':
          setLiveText((t) => t + event.text);
          break;
        case 'message':
          setMessages((list) => (list.some((m) => m.id === event.message.id) ? list : [...list, event.message]));
          setLiveText('');
          break;
        case 'toolCalls':
          setStatus(event.calls.map(describeToolCall).join(', ') + '...');
          break;
        case 'toolResult':
          setMessages((list) => (list.some((m) => m.id === event.message.id) ? list : [...list, event.message]));
          if (event.proposal) {
            const proposal = event.proposal;
            setProposals((list) => (list.some((p) => p.id === proposal.id) ? list : [...list, proposal]));
          }
          setStatus('');
          break;
        case 'error':
          setError(event.message);
          break;
        default:
          break;
      }
      if (terminal) {
        setRunning(false);
        setLiveText('');
        setStatus('');
        // Title and working notes can change during a run.
        void window.electronAPI.assistant.getConversation(event.conversationId).then((d) => setConversation(d.conversation)).catch(() => {});
      }
    });
    return unsubscribe;
  }, [refreshList]);

  const ensureConversation = async (): Promise<AssistantConversation> => {
    if (conversation) return conversation;
    const created = await window.electronAPI.assistant.createConversation();
    activeId.current = created.id;
    justCreated.current = created.id;
    setConversation(created);
    navigate(`/assistant/${created.id}`, { replace: true });
    await refreshList();
    return created;
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || running) return;
    setError(null);
    try {
      const target = await ensureConversation();
      setRunning(true);
      setDraft('');
      const result = await window.electronAPI.assistant.send({ conversationId: target.id, content });
      setMessages((list) => (list.some((m) => m.id === result.userMessage.id) ? list : [...list, result.userMessage]));
    } catch (e) {
      setRunning(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const newConversation = () => {
    navigate('/assistant');
    setDraft('');
  };

  const removeConversation = async (id: string) => {
    if (!window.confirm('Delete this conversation? Anything you already applied to the library stays.')) return;
    await window.electronAPI.assistant.deleteConversation(id);
    await refreshList();
    if (conversation?.id === id) navigate('/assistant');
  };

  const changeModel = async (model: string) => {
    setSettings(await window.electronAPI.assistant.setSettings({ model }));
    if (conversation) setConversation(await window.electronAPI.assistant.setModel(conversation.id, model));
  };

  const changeProposal = (updated: AssistantProposal) => {
    setProposals((list) => list.map((p) => (p.id === updated.id ? updated : p)));
  };

  const noModel = !(conversation?.model || settings.model);

  return (
    <div className={`assistant-page${contextOpen ? '' : ' context-closed'}`}>
      <div className="assistant-sidebar">
        <div className="assistant-sidebar-header">
          <h2>Assistant</h2>
          <button type="button" className="btn" onClick={newConversation}>
            + New
          </button>
        </div>
        <ul className="assistant-conversations">
          {conversations.map((c) => (
            <li key={c.id} className={`assistant-conversation${c.id === conversation?.id ? ' active' : ''}`}>
              <button type="button" className="assistant-conversation-open" title={c.title} onClick={() => navigate(`/assistant/${c.id}`)}>
                {c.title}
              </button>
              <button
                type="button"
                className="assistant-conversation-delete"
                aria-label={`Delete ${c.title}`}
                onClick={() => void removeConversation(c.id)}
              >
                ×
              </button>
            </li>
          ))}
          {conversations.length === 0 && <li className="text-muted" style={{ fontSize: 13, padding: 8 }}>No conversations yet.</li>}
        </ul>
      </div>

      <div className="assistant-main">
        <div className="assistant-main-header">
          <h1>{conversation?.title ?? 'New conversation'}</h1>
          <button type="button" className="btn" onClick={() => setContextOpen((v) => !v)}>
            {contextOpen ? 'Hide context' : 'Context'}
          </button>
        </div>

        <AssistantTranscript
          messages={messages}
          proposals={proposals}
          liveText={liveText}
          status={status}
          running={running}
          starters={STARTERS}
          onStarter={setDraft}
          onProposalResolved={changeProposal}
        />

        <div className="assistant-composer">
          {noModel && (
            <p className="field-error" style={{ marginTop: 0 }}>
              Choose a model in the Context panel to start.
            </p>
          )}
          {error && <p className="field-error" style={{ marginTop: 0 }}>{error}</p>}
          <LimitedTextarea
            limit={FIELD_LIMITS.chatMessage}
            rows={3}
            value={draft}
            disabled={running}
            placeholder="Ask for ideas, ask what's in your library, or ask for a draft. Enter sends, Shift+Enter adds a line."
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="assistant-composer-row">
            <span className="text-muted" style={{ fontSize: 12 }}>
              {conversation?.model || settings.model || 'No model chosen'}
            </span>
            {running ? (
              <button type="button" className="btn btn-danger" onClick={() => conversation && void window.electronAPI.assistant.cancel(conversation.id)}>
                Stop
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!draft.trim() || noModel} onClick={() => void send()}>
                Send
              </button>
            )}
          </div>
        </div>
      </div>

      {contextOpen && (
        <AssistantContextPanel
          settings={settings}
          models={models}
          conversation={conversation}
          disabled={running}
          onModel={(model) => void changeModel(model)}
          onContextWindow={async (contextWindow) => setSettings(await window.electronAPI.assistant.setSettings({ contextWindow }))}
          onStyleGuide={async (styleGuide) => setSettings(await window.electronAPI.assistant.setSettings({ styleGuide }))}
          onNotes={async (notes) => conversation && setConversation(await window.electronAPI.assistant.setNotes(conversation.id, notes))}
        />
      )}
    </div>
  );
}

export default function Assistant() {
  return (
    <OllamaRequiredGate>
      <AssistantInner />
    </OllamaRequiredGate>
  );
}
