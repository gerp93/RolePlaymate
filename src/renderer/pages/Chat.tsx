import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { Conversation, ImageMode } from '../../shared/types/conversation';
import { UserPersona } from '../../shared/types/userPersona';
import { CharacterImage } from '../../shared/types/characterImage';
import { PersonaImage } from '../../shared/types/personaImage';
import { useChatSession } from '../hooks/useChatSession';
import { useSecurity } from '../context/SecurityContext';
import MessageList from '../components/chat/MessageList';
import Composer from '../components/chat/Composer';
import DebugConsole from '../components/chat/DebugConsole';
import MemoriesDialog from '../components/chat/MemoriesDialog';
import MessagePromptDialog from '../components/chat/MessagePromptDialog';
import ImagePickerSelect from '../components/chat/ImagePickerSelect';
import { ChatDebugInfo } from '../../shared/types/chat';
import { setLastConversationId } from '../utils/lastConversation';
import { CHAT_FONT_SIZES, ChatFontSize, getStoredChatFontSize, saveChatFontSize } from '../utils/chatFontSize';
import { resolveMarginImage } from '../utils/avatarImage';
import { toImageUrl } from '../utils/imageUrl';
import { conciseModelLabel } from '../utils/modelPresentation';
import { OllamaModelInfo } from '../../shared/types/ollama';
import '../components/chat/Chat.css';

type ModelState =
  | { status: 'loading' }
  | { status: 'ready'; models: OllamaModelInfo[] }
  | { status: 'unavailable'; message: string };

const SHOW_PORTRAITS_KEY = 'roleplaymate-chat-show-portraits';
const SIDEBAR_COLLAPSED_KEY = 'roleplaymate-chat-sidebar-collapsed';

function getStoredBoolean(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function saveBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // localStorage not available
  }
}

export default function Chat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { hiddenUnlocked } = useSecurity();

  const [characters, setCharacters] = useState<Character[]>([]);
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [modelState, setModelState] = useState<ModelState>({ status: 'loading' });

  const [characterId, setCharacterId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [characterImages, setCharacterImages] = useState<CharacterImage[]>([]);
  const [personaImages, setPersonaImages] = useState<PersonaImage[]>([]);
  const [characterImageMode, setCharacterImageMode] = useState<ImageMode>('carousel');
  const [characterImageId, setCharacterImageId] = useState<string | null>(null);
  const [personaImageMode, setPersonaImageMode] = useState<ImageMode>('carousel');
  const [personaImageId, setPersonaImageId] = useState<string | null>(null);
  const [carouselTick, setCarouselTick] = useState(0);
  const [fontSize, setFontSize] = useState<ChatFontSize>(() => getStoredChatFontSize());
  const [showPortraits, setShowPortraits] = useState(() => getStoredBoolean(SHOW_PORTRAITS_KEY));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getStoredBoolean(SIDEBAR_COLLAPSED_KEY));
  const [model, setModel] = useState('');
  const [samplers, setSamplers] = useState({ temperature: 0.7, maxTokens: 256 });
  // This model's tuned defaults (Model Tuning settings page), kept separately from `samplers`
  // so a manual tweak doesn't overwrite what "reset" should go back to.
  const [defaultSamplers, setDefaultSamplers] = useState({ temperature: 0.7, maxTokens: 256 });
  const [showDebug, setShowDebug] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [showMemories, setShowMemories] = useState(false);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptDialogDebug, setPromptDialogDebug] = useState<ChatDebugInfo | null>(null);

  // Reloads the composer's Temperature/Max Tokens sliders to whatever this model's tuned
  // defaults are (Model Tuning settings page) every time the selected model changes -- same
  // convention a generation preset switch uses elsewhere: pick a new model, get its starting
  // point, then nudge from there if you want. A manual tweak lasts until the model changes
  // again, not until the conversation does.
  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    void window.electronAPI.modelTuning.getEffective(model).then((effective) => {
      if (!cancelled) {
        const next = { temperature: effective.temperature, maxTokens: effective.maxTokens };
        setSamplers(next);
        setDefaultSamplers(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [model]);

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
      // state to render, not an error to throw at the user. listModelsDetailed rather than
      // listModels for the same real Ollama metadata (params/family) the Model Tuning page
      // shows, so the picker can label options with more than a raw tag.
      const result = await window.electronAPI.ollama.listModelsDetailed();
      if (result.available) {
        setModelState({ status: 'ready', models: result.models });
        setModel((current) => current || result.models[0]?.name || '');
      } else {
        setModelState({ status: 'unavailable', message: result.message });
      }
    })();
    // hiddenUnlocked: characters/personas/conversations already fetched under the previous
    // lock state hold ciphertext for anything hidden -- re-fetch on every lock/unlock so
    // content updates immediately instead of only after a manual reload.
  }, [refreshConversations, hiddenUnlocked]);

  // Opening an existing conversation adopts its character, persona, model, and avatar mode.
  useEffect(() => {
    if (!conversationId) return;
    void (async () => {
      const conversation = await window.electronAPI.conversations.getById(conversationId);
      if (!conversation) return;
      if (conversation.characterId) setCharacterId(conversation.characterId);
      setPersonaId(conversation.userPersonaId ?? '');
      setModel((current) => conversation.model || current);
      setCharacterImageMode(conversation.characterImageMode);
      setCharacterImageId(conversation.characterImageId);
      setPersonaImageMode(conversation.personaImageMode);
      setPersonaImageId(conversation.personaImageId);
    })();
  }, [conversationId]);

  // Loaded independently of the conversation-open effect above so a gallery also shows up
  // right after picking a character/persona for a brand-new (not yet created) conversation.
  useEffect(() => {
    if (!characterId) {
      setCharacterImages([]);
      return;
    }
    void window.electronAPI.characterImages.getByCharacter(characterId).then(setCharacterImages);
  }, [characterId]);

  useEffect(() => {
    if (!personaId) {
      setPersonaImages([]);
      return;
    }
    void window.electronAPI.personaImages.getByPersona(personaId).then(setPersonaImages);
  }, [personaId]);

  // Drives the margin portraits' carousel mode -- one shared tick so both sides advance on the
  // same 10-second beat even when their galleries are different sizes (each side just indexes
  // into its own array via tick % length). Only runs while there's something to animate.
  useEffect(() => {
    if (!showPortraits || !conversationId) return;
    const interval = setInterval(() => setCarouselTick((t) => t + 1), 10_000);
    return () => clearInterval(interval);
  }, [showPortraits, conversationId]);

  const activeConversation = conversations.find((c) => c.id === conversationId) ?? null;
  const character = characters.find((c) => c.id === characterId) ?? null;
  const persona = personas.find((p) => p.id === personaId) ?? null;

  // Dropdown options and the sidebar list drop hidden entries while locked; a conversation
  // that already has a hidden character/persona selected (opened before locking, or via an
  // old link) still resolves fine above -- only what's offered/listed is filtered here.
  const visibleCharacters = characters.filter((c) => hiddenUnlocked || !c.isHidden);
  const visiblePersonas = personas.filter((p) => hiddenUnlocked || !p.isHidden);
  const isConversationHidden = (c: Conversation) =>
    Boolean(
      (c.characterId && characters.find((ch) => ch.id === c.characterId)?.isHidden) ||
        (c.userPersonaId && personas.find((p) => p.id === c.userPersonaId)?.isHidden)
    );
  const visibleConversations = conversations.filter((c) => hiddenUnlocked || !isConversationHidden(c));

  // No more free-text titles derived from the opening message -- every conversation is
  // labeled the same standard way, by who's in it. `characters`/`personas` are already the
  // full lists (not the hidden-filtered ones above), so this resolves correctly even for a
  // conversation whose character/persona happens to be hidden right now.
  const conversationLabel = (c: Conversation): string => {
    const charName = characters.find((ch) => ch.id === c.characterId)?.name ?? 'Assistant';
    const userPersonaName = c.userPersonaId ? personas.find((p) => p.id === c.userPersonaId)?.name : null;
    return userPersonaName ? `${charName} & ${userPersonaName}` : charName;
  };

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

  const handleContinue = useCallback(
    async (directions: string) => {
      if (!characterId || !model) return;
      await session.continueAsCharacter({
        characterId,
        model,
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

  const handleFontSizeChange = useCallback((size: ChatFontSize) => {
    setFontSize(size);
    saveChatFontSize(size);
  }, []);

  // Purely cosmetic and not locked by selectionLocked -- picking a specific portrait (or going
  // back to the carousel) is fine mid-conversation since it never touches the model's context.
  const handleCharacterImageChange = useCallback(
    async (value: string) => {
      const mode: ImageMode = value === 'carousel' ? 'carousel' : 'static';
      const id = value === 'carousel' ? null : value;
      setCharacterImageMode(mode);
      setCharacterImageId(id);
      if (conversationId) {
        await window.electronAPI.conversations.setImageMode(conversationId, {
          characterImageMode: mode,
          characterImageId: id,
        });
      }
    },
    [conversationId]
  );

  const handlePersonaImageChange = useCallback(
    async (value: string) => {
      const mode: ImageMode = value === 'carousel' ? 'carousel' : 'static';
      const id = value === 'carousel' ? null : value;
      setPersonaImageMode(mode);
      setPersonaImageId(id);
      if (conversationId) {
        await window.electronAPI.conversations.setImageMode(conversationId, {
          personaImageMode: mode,
          personaImageId: id,
        });
      }
    },
    [conversationId]
  );

  // A conversation involving a hidden character/persona must disappear the instant the app
  // locks (not just drop out of the sidebar list) -- otherwise the already-loaded transcript
  // would keep showing decrypted content on screen after the toggle says locked. Also covers
  // reaching a hidden conversation's URL directly while already locked.
  useEffect(() => {
    if (!hiddenUnlocked && conversationId && (character?.isHidden || persona?.isHidden)) {
      navigate('/chat');
    }
  }, [hiddenUnlocked, conversationId, character, persona, navigate]);

  const canChat = Boolean(conversationId && characterId && model);
  const modelOptions = useMemo(
    () => (modelState.status === 'ready' ? modelState.models : []),
    [modelState]
  );

  const handleShowPortraitsChange = useCallback((value: boolean) => {
    setShowPortraits(value);
    saveBoolean(SHOW_PORTRAITS_KEY, value);
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      saveBoolean(SIDEBAR_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const characterPortrait = resolveMarginImage(characterImages, characterImageMode, characterImageId, carouselTick);
  const personaPortrait = resolveMarginImage(personaImages, personaImageMode, personaImageId, carouselTick);

  // Same threshold the old two-row layout used to decide whether the transcript column caps
  // at 900px (leaving room for the two portrait margins) or just fills the available width.
  const portraitsActive = Boolean(showPortraits && conversationId);

  return (
    <div className={`chat-page${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className={`chat-sidebar${sidebarCollapsed ? ' chat-sidebar-collapsed' : ''}`}>
        {sidebarCollapsed ? (
          <button
            type="button"
            className="chat-sidebar-collapse-btn"
            title="Show conversations"
            onClick={toggleSidebarCollapsed}
          >
            »
          </button>
        ) : (
          <>
            <div className="chat-sidebar-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="chat-sidebar-collapse-btn"
                  title="Hide conversations"
                  onClick={toggleSidebarCollapsed}
                >
                  «
                </button>
                <h2>Conversations</h2>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => navigate('/chat')}>
                New
              </button>
            </div>
            <ul className="chat-conversation-list">
              {visibleConversations.length === 0 && <li className="text-muted">No conversations yet.</li>}
              {visibleConversations.map((conversation) => (
                <li
                  key={conversation.id}
                  className={conversation.id === conversationId ? 'active' : ''}
                >
                  <button type="button" onClick={() => navigate(`/chat/${conversation.id}`)}>
                    <span className="chat-conversation-title">{conversationLabel(conversation)}</span>
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
          </>
        )}
      </aside>

      <section className="chat-main">
        <div className="chat-columns" style={{ '--chat-bubble-font-size': `${fontSize}px` } as React.CSSProperties}>
          {/* Left column: the character's name/select up top, its large portrait below that,
              and the image-picker dropdown (which picture to show) below the portrait -- the
              control for "which picture" sits under the picture it controls, not above it. */}
          <div className={`chat-column chat-column-side${portraitsActive ? ' chat-column-side-grown' : ''}`}>
            <div className="chat-column-header">
              {selectionLocked ? (
                // Can't be changed once the conversation has real turns in it -- the transcript
                // is already written from this character's point of view, so a dropdown here
                // would just offer a choice that can't actually be made. Plain text instead.
                <div className="chat-header-static">
                  <span className="chat-header-static-value">{character?.name ?? '—'}</span>
                </div>
              ) : (
                <label>
                  Character
                  <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
                    <option value="">Select…</option>
                    {visibleCharacters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {portraitsActive && (
              <div className="chat-portrait-margin">
                {characterPortrait && <img src={toImageUrl(characterPortrait.path)} alt={character?.name ?? ''} />}
              </div>
            )}

            {conversationId && characterImages.length > 0 && (
              <ImagePickerSelect
                label="Character image"
                images={characterImages}
                mode={characterImageMode}
                staticId={characterImageId}
                onChange={(value) => void handleCharacterImageChange(value)}
              />
            )}
          </div>

          {/* Center column: banners up top, the transcript filling the rest, then the
              composer, then the model/memories/debug/more controls -- below the transcript the
              same way the side columns' picker sits below their portrait, with the More panel
              (when open) trailing after that. Capped at 900px only while the side columns
              actually have portraits to show -- otherwise it just fills whatever width is
              available. */}
          <div className={`chat-column chat-column-center${portraitsActive ? ' chat-column-center-capped' : ''}`}>
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
                  onEditLast={(content) => void session.editLastMessage(content)}
                  onDeleteLast={() => void session.deleteLastMessage()}
                  onViewPrompt={(messageId) => void handleViewPrompt(messageId)}
                  characterName={character?.name ?? 'Assistant'}
                  personaName={persona?.name ?? 'You'}
                  characterImages={characterImages}
                  personaImages={personaImages}
                />
              ) : (
                <div className="chat-transcript chat-transcript-empty">
                  <p className="text-muted">
                    Pick a character{visiblePersonas.length > 0 ? ', a persona' : ''} and a model, then start a
                    chat.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary chat-start-btn"
                    disabled={!characterId || !model}
                    onClick={() => void startConversation()}
                  >
                    Start Chat
                  </button>
                </div>
              )}

              <Composer
                disabled={!canChat}
                isGenerating={session.isGenerating}
                onSend={(message, directions) => void handleSend(message, directions)}
                onContinue={(directions) => void handleContinue(directions)}
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

              <div className="chat-settings-row">
                <select
                  className="chat-model-select"
                  value={model}
                  // Unlike character/persona, the model can change freely mid-conversation --
                  // each turn already carries its own model, so switching doesn't disturb
                  // anything already said, only what generates next.
                  disabled={modelState.status !== 'ready'}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {modelOptions.length === 0 && <option value="">—</option>}
                  {modelOptions.map((m) => (
                    <option key={m.name} value={m.name} title={m.name}>
                      {conciseModelLabel(m)}
                    </option>
                  ))}
                </select>

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

                <button
                  type="button"
                  className={`btn chat-more-toggle${settingsExpanded ? ' active' : ''}`}
                  onClick={() => setSettingsExpanded((open) => !open)}
                >
                  ⚙ More {settingsExpanded ? '▴' : '▾'}
                </button>
              </div>

              {settingsExpanded && (
                <div className="chat-settings-more">
                  <label>
                    Text size
                    <select
                      value={fontSize}
                      onChange={(e) => handleFontSizeChange(Number(e.target.value) as ChatFontSize)}
                    >
                      {CHAT_FONT_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}px
                        </option>
                      ))}
                    </select>
                  </label>

                  {conversationId && (characterImages.length > 0 || personaImages.length > 0) && (
                    <label className="chat-portraits-toggle">
                      <input
                        type="checkbox"
                        checked={showPortraits}
                        onChange={(e) => handleShowPortraitsChange(e.target.checked)}
                      />
                      Large portraits
                    </label>
                  )}

                  <label className="chat-slider">
                    Temperature <output>{samplers.temperature.toFixed(2)}</output>
                    <input
                      type="range"
                      min={0.1}
                      max={1.5}
                      step={0.1}
                      value={samplers.temperature}
                      onChange={(e) => setSamplers({ ...samplers, temperature: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      className="chat-slider-reset"
                      title={`Reset to default (${defaultSamplers.temperature.toFixed(2)})`}
                      disabled={samplers.temperature === defaultSamplers.temperature}
                      onClick={() => setSamplers((s) => ({ ...s, temperature: defaultSamplers.temperature }))}
                    >
                      ↺
                    </button>
                  </label>

                  <label className="chat-slider">
                    Max tokens <output>{samplers.maxTokens}</output>
                    <input
                      type="range"
                      min={64}
                      max={512}
                      step={64}
                      value={samplers.maxTokens}
                      onChange={(e) => setSamplers({ ...samplers, maxTokens: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      className="chat-slider-reset"
                      title={`Reset to default (${defaultSamplers.maxTokens})`}
                      disabled={samplers.maxTokens === defaultSamplers.maxTokens}
                      onClick={() => setSamplers((s) => ({ ...s, maxTokens: defaultSamplers.maxTokens }))}
                    >
                      ↺
                    </button>
                  </label>
                </div>
              )}
            </div>

            {showDebug && (
              <aside className="chat-debug-panel">
                <DebugConsole debug={session.debug} />
              </aside>
            )}
          </div>

          {/* Right column: the persona's own controls, mirroring the left. */}
          <div className={`chat-column chat-column-side${portraitsActive ? ' chat-column-side-grown' : ''}`}>
            <div className="chat-column-header">
              {selectionLocked ? (
                <div className="chat-header-static">
                  <span className="chat-header-static-value">{persona?.name ?? 'None'}</span>
                </div>
              ) : (
                <label>
                  Persona
                  <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
                    <option value="">None</option>
                    {visiblePersonas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {portraitsActive && (
              <div className="chat-portrait-margin">
                {personaPortrait && <img src={toImageUrl(personaPortrait.path)} alt={persona?.name ?? ''} />}
              </div>
            )}

            {conversationId && personaImages.length > 0 && (
              <ImagePickerSelect
                label="Persona image"
                images={personaImages}
                mode={personaImageMode}
                staticId={personaImageId}
                onChange={(value) => void handlePersonaImageChange(value)}
              />
            )}
          </div>
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
            {conversationLabel(activeConversation)} · {session.messages.length} messages
          </footer>
        )}
      </section>
    </div>
  );
}
