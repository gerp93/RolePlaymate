import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { Conversation } from '../../shared/types/conversation';
import { UserPersona } from '../../shared/types/userPersona';
import { useChatSession } from '../hooks/useChatSession';
import MessageList from '../components/chat/MessageList';
import Composer from '../components/chat/Composer';
import DebugConsole from '../components/chat/DebugConsole';
import MemoriesDialog from '../components/chat/MemoriesDialog';
import MessagePromptDialog from '../components/chat/MessagePromptDialog';
import { ChatDebugInfo } from '../../shared/types/chat';
import { setLastConversationId } from '../utils/lastConversation';
import '../components/chat/Chat.css';

type ModelState =
  | { status: 'loading' }
  | { status: 'ready'; models: string[] }
  | { status: 'unavailable'; message: string };

export default function Chat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();

  const [characters, setCharacters] = useState<Character[]>([]);
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [modelState, setModelState] = useState<ModelState>({ status: 'loading' });

  const [characterId, setCharacterId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [model, setModel] = useState('');
  const [samplers, setSamplers] = useState({ temperature: 0.7, maxTokens: 256 });
  const [showDebug, setShowDebug] = useState(false);
  const [showMemories, setShowMemories] = useState(false);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptDialogDebug, setPromptDialogDebug] = useState<ChatDebugInfo | null>(null);

  const handleViewPrompt = useCallback(async (messageId: string) => {
    setPromptDialogOpen(true);
    setPromptDialogDebug(null);
    setPromptDialogDebug(await window.electronAPI.chat.getMessageDebug(messageId));
  }, []);

  const session = useChatSession(conversationId ?? null);

  // Remembers the open conversation so switching tabs and back to Chat returns here instead
  // of resetting to the picker -- see Layout, which reads this to point the nav link at it.
  useEffect(() => {
    if (conversationId) setLastConversationId(conversationId);
  }, [conversationId]);

  const refreshConversations = useCallback(async () => {
    setConversations(await window.electronAPI.conversations.getAll());
  }, []);

  useEffect(() => {
    void (async () => {
      const [chars, people] = await Promise.all([
        window.electronAPI.characters.getAll(),
        window.electronAPI.personas.getAll(),
      ]);
      setCharacters(chars);
      setPersonas(people);
      await refreshConversations();

      // The library must stay usable with no Ollama server, so an unreachable server is a
      // state to render, not an error to throw at the user.
      const result = await window.electronAPI.ollama.listModels();
      if (result.available) {
        setModelState({ status: 'ready', models: result.models });
        setModel((current) => current || result.models[0] || '');
      } else {
        setModelState({ status: 'unavailable', message: result.message });
      }
    })();
  }, [refreshConversations]);

  // Opening an existing conversation adopts its character, persona and model.
  useEffect(() => {
    if (!conversationId) return;
    void (async () => {
      const conversation = await window.electronAPI.conversations.getById(conversationId);
      if (!conversation) return;
      if (conversation.characterId) setCharacterId(conversation.characterId);
      setPersonaId(conversation.userPersonaId ?? '');
      setModel((current) => conversation.model || current);
    })();
  }, [conversationId]);

  const activeConversation = conversations.find((c) => c.id === conversationId) ?? null;
  const character = characters.find((c) => c.id === characterId) ?? null;
  const persona = personas.find((p) => p.id === personaId) ?? null;

  /**
   * Locked once a conversation has messages, matching the source: the system prompt is built
   * from the character, so swapping mid-conversation would silently change who the model
   * thinks it is halfway through a transcript.
   */
  const selectionLocked = Boolean(conversationId && session.messages.length > 0);

  const startConversation = useCallback(async () => {
    if (!characterId || !model) return;
    const conversation = await window.electronAPI.conversations.create({
      characterId,
      model,
      userPersonaId: personaId || undefined,
    });
    await refreshConversations();
    navigate(`/chat/${conversation.id}`);
  }, [characterId, model, personaId, navigate, refreshConversations]);

  const handleSend = useCallback(
    async (message: string, directions: string) => {
      if (!characterId || !model) return;
      await session.send({
        characterId,
        model,
        message,
        personaId: personaId || undefined,
        directions: directions || undefined,
        samplers,
      });
      void refreshConversations();
    },
    [characterId, model, personaId, samplers, session, refreshConversations]
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await window.electronAPI.conversations.delete(id);
      await refreshConversations();
      if (id === conversationId) navigate('/chat');
    },
    [conversationId, navigate, refreshConversations]
  );

  const canChat = Boolean(conversationId && characterId && model);
  const modelOptions = useMemo(
    () => (modelState.status === 'ready' ? modelState.models : []),
    [modelState]
  );

  return (
    <div className="chat-page">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <h2>Conversations</h2>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/chat')}>
            New
          </button>
        </div>
        <ul className="chat-conversation-list">
          {conversations.length === 0 && <li className="text-muted">No conversations yet.</li>}
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className={conversation.id === conversationId ? 'active' : ''}
            >
              <button type="button" onClick={() => navigate(`/chat/${conversation.id}`)}>
                <span className="chat-conversation-title">{conversation.title}</span>
                <span className="chat-conversation-meta">{conversation.model}</span>
              </button>
              <button
                type="button"
                className="chat-conversation-delete"
                title="Delete conversation"
                onClick={() => void deleteConversation(conversation.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <label>
            Character
            <select
              value={characterId}
              disabled={selectionLocked}
              onChange={(e) => setCharacterId(e.target.value)}
            >
              <option value="">Select…</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Persona
            <select
              value={personaId}
              disabled={selectionLocked}
              onChange={(e) => setPersonaId(e.target.value)}
            >
              <option value="">None</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Model
            <select
              value={model}
              // Unlike character/persona, the model can change freely mid-conversation -- each
              // turn already carries its own model, so switching doesn't disturb anything
              // already said, only what generates next.
              disabled={modelState.status !== 'ready'}
              onChange={(e) => setModel(e.target.value)}
            >
              {modelOptions.length === 0 && <option value="">—</option>}
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {!conversationId && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!characterId || !model}
              onClick={() => void startConversation()}
            >
              Start chat
            </button>
          )}

          {conversationId && (
            <button
              type="button"
              className="btn chat-memories-toggle"
              onClick={() => setShowMemories(true)}
            >
              🧠 Memories
              {session.memoryCount > 0 && (
                <span className="chat-memory-badge">{session.memoryCount}</span>
              )}
            </button>
          )}

          <button
            type="button"
            className={`btn chat-debug-toggle${showDebug ? ' active' : ''}`}
            onClick={() => setShowDebug((open) => !open)}
          >
            🔍 Debug
          </button>
        </header>

        {modelState.status === 'unavailable' && (
          <div className="chat-banner chat-banner-warning">
            <strong>Ollama isn&apos;t reachable.</strong> {modelState.message}
            <br />
            The character library works without it — start <code>ollama serve</code> to chat.
          </div>
        )}

        {session.error && (
          <div className="chat-banner chat-banner-error">
            <strong>That turn failed.</strong> {session.error}
            <button type="button" className="btn" onClick={session.dismissError}>
              Dismiss
            </button>
          </div>
        )}

        <div className="chat-body">
          <div className="chat-conversation">
            {conversationId ? (
              <MessageList
                messages={session.messages}
                streamingText={session.streamingText}
                isGenerating={session.isGenerating}
                isRegenerating={session.isRegenerating}
                variants={session.variants}
                onRegenerate={() => void session.regenerate(samplers, model)}
                onSelectVariant={(variantId) => void session.selectVariant(variantId)}
                onDeleteLast={() => void session.deleteLastMessage()}
                onViewPrompt={(messageId) => void handleViewPrompt(messageId)}
                characterName={character?.name ?? 'Assistant'}
                personaName={persona?.name ?? 'You'}
              />
            ) : (
              <div className="chat-transcript chat-transcript-empty">
                <p className="text-muted">
                  Pick a character{personas.length > 0 ? ', a persona' : ''} and a model, then start a
                  chat.
                </p>
              </div>
            )}

            <Composer
              disabled={!canChat}
              isGenerating={session.isGenerating}
              samplers={samplers}
              onSamplersChange={setSamplers}
              onSend={(message, directions) => void handleSend(message, directions)}
              onCancel={() => void session.cancel()}
              onSuggest={
                canChat && conversationId
                  ? async () => {
                      const { suggestion } = await window.electronAPI.chat.suggestReply({
                        conversationId,
                        characterId,
                        model,
                        personaId: personaId || undefined,
                      });
                      return suggestion;
                    }
                  : undefined
              }
            />
          </div>

          {showDebug && (
            <aside className="chat-debug-panel">
              <DebugConsole debug={session.debug} />
            </aside>
          )}
        </div>

        {showMemories && conversationId && (
          <MemoriesDialog
            conversationId={conversationId}
            onClose={() => setShowMemories(false)}
            onChanged={() => void session.refreshMemoryCount()}
          />
        )}

        {promptDialogOpen && (
          <MessagePromptDialog debug={promptDialogDebug} onClose={() => setPromptDialogOpen(false)} />
        )}

        {activeConversation && (
          <footer className="chat-footer text-muted">
            {activeConversation.title} · {session.messages.length} messages
          </footer>
        )}
      </section>
    </div>
  );
}
