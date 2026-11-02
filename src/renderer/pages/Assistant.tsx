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
  // A message typed while a reply is still being written: sent when that reply finishes.
  const [queued, setQueued] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(true);

  // The stream listener is attached once, so it reads the current conversation through a ref.
  const activeId = useRef<string | null>(null);
  activeId.current = conversation?.id ?? null;
  // A conversation this page just created is already in state; reloading it as the route changes could
  // overwrite a run that has begun by then.
  const justCreated = useRef<string | null>(null);
  // How the last run ended, so a queued message is only sent after a clean finish -- never after a
  // Stop or an error, where the user would not expect it to go out.
  const outcomeRef = useRef<'done' | 'error' | 'cancelled' | null>(null);

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
      if (terminal) outcomeRef.current = event.type as 'done' | 'error' | 'cancelled';

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

  const submit = async (content: string, fromDraft: boolean) => {
    setError(null);
    outcomeRef.current = null;
    try {
      const target = await ensureConversation();
      setRunning(true);
      if (fromDraft) setDraft('');
      const result = await window.electronAPI.assistant.send({ conversationId: target.id, content });
      setMessages((list) => (list.some((m) => m.id === result.userMessage.id) ? list : [...list, result.userMessage]));
    } catch (e) {
      setRunning(false);
      setError(e instanceof Error ? e.message : String(e));
      // A queued message that could not go out is given back, not lost.
      if (!fromDraft) setDraft((d) => (d.trim() ? `${content}\n\n${d}` : content));
    }
  };

  /** Sends now, or -- while a reply is still being written -- queues it behind that reply. */
  const send = () => {
    const content = draft.trim();
    if (!content) return;
    if (running) {
      setQueued((q) => (q ? `${q}\n\n${content}` : content));
      setDraft('');
      return;
    }
    void submit(content, true);
  };

  /** Stop and undo: removes this exchange (your message, its tool results and proposals) and puts your
   * text back in the box so you can steer it differently. Nothing in the library is touched. */
  const rollback = async () => {
    if (!conversation) return;
    try {
      const { content } = await window.electronAPI.assistant.rollback(conversation.id);
      await load(conversation.id);
      setDraft((d) => (d.trim() ? `${content}\n\n${d}` : content));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const takeBackQueued = () => {
    if (queued) setDraft((d) => (d.trim() ? `${queued}\n\n${d}` : queued));
    setQueued(null);
  };

  // When a run ends: a clean finish sends what was queued; anything else (Stop, error, leaving the
  // conversation) puts it back in the box for the user to decide.
  useEffect(() => {
    if (running || !queued) return;
    const text = queued;
    const outcome = outcomeRef.current;
    setQueued(null);
    outcomeRef.current = null;
    if (outcome === 'done') void submit(text, false);
    else setDraft((d) => (d.trim() ? `${text}\n\n${d}` : text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, queued]);

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
          {queued && (
            <div className="assistant-queued">
              <span className="text-muted">Queued, sends when the reply finishes: {queued.length > 90 ? `${queued.slice(0, 90)}…` : queued}</span>
              <button type="button" className="btn" onClick={takeBackQueued}>
                Take back
              </button>
            </div>
          )}
          <LimitedTextarea
            limit={FIELD_LIMITS.chatMessage}
            rows={3}
            value={draft}
            placeholder={
              running
                ? 'Type your next message. Enter queues it until the reply finishes.'
                : "Ask for ideas, ask what's in your library, or ask for a draft. Enter sends, Shift+Enter adds a line."
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="assistant-composer-row">
            <span className="text-muted" style={{ fontSize: 12 }}>
              {conversation?.model || settings.model || 'No model chosen'}
            </span>
            <span className="assistant-composer-buttons">
              {running && (
                <>
                  <button
                    type="button"
                    className="btn btn-danger"
                    title="Stop and remove this exchange, putting your message back in the box. Nothing in the library is changed."
                    onClick={() => void rollback()}
                  >
                    Stop &amp; roll back
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    title="Stop here and keep what has been said so far."
                    onClick={() => conversation && void window.electronAPI.assistant.cancel(conversation.id)}
                  >
                    Stop
                  </button>
                </>
              )}
              <button type="button" className="btn btn-primary" disabled={!draft.trim() || noModel} onClick={send}>
                {running ? 'Queue next' : 'Send'}
              </button>
            </span>
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
