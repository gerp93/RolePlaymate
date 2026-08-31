import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { Conversation, ConversationListItem, ImageMode } from '../../shared/types/conversation';
import { UserPersona } from '../../shared/types/userPersona';
import { CharacterImage } from '../../shared/types/characterImage';
import { PersonaImage } from '../../shared/types/personaImage';
import { Scenario, ScenarioImage } from '../../shared/types/scenario';
import { useChatSession } from '../hooks/useChatSession';
import { Message, ttsPathForMessage } from '../../shared/types/message';
import { unlockSpeechPlayback, useTtsPlayback } from '../hooks/useTtsPlayback';
import { CharacterTtsVoice } from '../../shared/types/tts';
import { voicesMatch } from '../../shared/utils/ttsSegments';
import { useSecurity } from '../context/SecurityContext';
import MessageList from '../components/chat/MessageList';
import Composer from '../components/chat/Composer';
import MessagePromptDialog from '../components/chat/MessagePromptDialog';
import ChatRightSidebar, { RightSidebarTab } from '../components/chat/ChatRightSidebar';
import ChatSettingsPanel from '../components/chat/ChatSettingsPanel';
import ImagePickerSelect from '../components/chat/ImagePickerSelect';
import ChatStartScreen, { startScreenPortraitUrl } from '../components/chat/ChatStartScreen';
import StartScreenPicker from '../components/chat/StartScreenPicker';
import { buildModelPickerOptions, buildPersonaPickerOptions } from '../utils/chatPickerOptions';
import { ChatDebugInfo } from '../../shared/types/chat';
import { setLastConversationId, clearLastConversationId, getLastConversationId } from '../utils/lastConversation';
import {
  clearSessionActiveConversationId,
  getSessionActiveConversationId,
  setSessionActiveConversationId,
} from '../utils/chatSession';
import { ChatFontSize, getStoredChatFontSize, saveChatFontSize } from '../utils/chatFontSize';
import { resolveMarginImage } from '../utils/avatarImage';
import { toImageUrl } from '../utils/imageUrl';
import { OllamaModelInfo } from '../../shared/types/ollama';
import { isEmbeddingModel } from '../../shared/embeddingModel';
import ChatOllamaSetup from '../components/chat/ChatOllamaSetup';
import EmbeddingModelMissingPrompt from '../components/chat/EmbeddingModelMissingPrompt';
import OllamaSetupLoading from '../components/chat/OllamaSetupLoading';
import '../components/chat/Chat.css';

type ModelState =
  | { status: 'loading' }
  | { status: 'ready'; models: OllamaModelInfo[] }
  | { status: 'unavailable'; message: string };

function formatConversationListDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString(undefined, options);
}

function CastDescription({ text }: { text: string | null | undefined }) {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return (
    <span className="chat-cast-subtext text-muted" title={trimmed}>
      {trimmed}
    </span>
  );
}

/** Sidebar only lists conversations past the greeting-only draft stage. */
function isCommittedSidebarConversation(c: ConversationListItem): boolean {
  return c.messageCount > 1 || c.userMessageCount > 0;
}

const SHOW_PORTRAITS_KEY = 'roleplaymate-chat-show-portraits';
const SIDEBAR_COLLAPSED_KEY = 'roleplaymate-chat-sidebar-collapsed';
/** Matches `@container chat-main (max-width: 1000px)` in Chat.css — below this the
 *  side portrait columns don't fit. The Settings-tab Portraits dropdown stays visible but disabled. */
const PORTRAITS_MIN_MAIN_WIDTH = 1000;

function ConversationsRevealIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
      />
    </svg>
  );
}

function SettingsRevealIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.49.49 0 0 0-.6-.22l-2.39.96c-.5-.4-1.04-.72-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.42h-3.84a.49.49 0 0 0-.48.42l-.36 2.54c-.58.22-1.12.54-1.62.94l-2.39-.96a.49.49 0 0 0-.6.22L2.74 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.86 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.22.4.31.6.22l2.39-.96c.5.4 1.04.72 1.62.94l.36 2.54c.05.24.25.42.48.42h3.84c.24 0 .43-.18.48-.42l.36-2.54c.58-.22 1.12-.54 1.62-.94l2.39.96c.22.09.46 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
      />
    </svg>
  );
}

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
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [modelState, setModelState] = useState<ModelState>({ status: 'loading' });
  // Models unchecked from "In Chat" on the Model Tuning page -- excluded from the dropdown
  // below, though a conversation already using one keeps working (see modelOptions).
  const [disabledModels, setDisabledModels] = useState<Set<string>>(new Set());

  const [characterId, setCharacterId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [characterImages, setCharacterImages] = useState<CharacterImage[]>([]);
  const [personaImages, setPersonaImages] = useState<PersonaImage[]>([]);
  const [scenarioImages, setScenarioImages] = useState<ScenarioImage[]>([]);
  const [startCharacterCovers, setStartCharacterCovers] = useState<Record<string, CharacterImage[]>>({});
  const [startPersonaCovers, setStartPersonaCovers] = useState<Record<string, PersonaImage[]>>({});
  const [startScenarioCoverUrls, setStartScenarioCoverUrls] = useState<Record<string, string | null>>({});
  const [characterImageMode, setCharacterImageMode] = useState<ImageMode>('carousel');
  const [characterImageId, setCharacterImageId] = useState<string | null>(null);
  const [scenarioImageId, setScenarioImageId] = useState<string | null>(null);
  const [personaImageMode, setPersonaImageMode] = useState<ImageMode>('carousel');
  const [personaImageId, setPersonaImageId] = useState<string | null>(null);
  const [carouselTick, setCarouselTick] = useState(0);
  const [fontSize, setFontSize] = useState<ChatFontSize>(() => getStoredChatFontSize());
  const [showPortraits, setShowPortraits] = useState(() => getStoredBoolean(SHOW_PORTRAITS_KEY));
  const [portraitsTooNarrow, setPortraitsTooNarrow] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getStoredBoolean(SIDEBAR_COLLAPSED_KEY));
  const [model, setModel] = useState('');
  const [samplers, setSamplers] = useState({ temperature: 0.7, maxTokens: 256 });
  // This model's tuned defaults (Model Tuning settings page), kept separately from `samplers`
  // so a manual tweak doesn't overwrite what "reset" should go back to.
  const [defaultSamplers, setDefaultSamplers] = useState({ temperature: 0.7, maxTokens: 256 });
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>('settings');
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptDialogDebug, setPromptDialogDebug] = useState<ChatDebugInfo | null>(null);
  const [promptDialogLoading, setPromptDialogLoading] = useState(false);
  // Owned here rather than inside Composer so switching personas mid-conversation can
  // prepopulate a stock scene note without reaching into the composer's internals.
  const [directions, setDirections] = useState('');
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [keepForever, setKeepForever] = useState(false);

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
    setPromptDialogLoading(true);
    try {
      setPromptDialogDebug(await window.electronAPI.chat.getMessageDebug(messageId));
    } finally {
      setPromptDialogLoading(false);
    }
  }, []);

  const tts = useTtsPlayback();
  const portraitsObserverRef = useRef<ResizeObserver | null>(null);
  const chatMainRef = useCallback((el: HTMLElement | null) => {
    portraitsObserverRef.current?.disconnect();
    portraitsObserverRef.current = null;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      setPortraitsTooNarrow(width <= PORTRAITS_MIN_MAIN_WIDTH);
    });
    observer.observe(el);
    portraitsObserverRef.current = observer;
  }, []);
  const ttsCharacterVoiceRef = useRef<CharacterTtsVoice | null>(null);
  const ttsPersonaVoiceRef = useRef<CharacterTtsVoice | null>(null);
  const ttsNarratorVoiceRef = useRef<CharacterTtsVoice | null>(null);
  const ttsCharacterTrackRef = useRef(tts.characterTrack);
  const ttsPersonaTrackRef = useRef(tts.personaTrack);
  const ttsReadingModeRef = useRef(tts.readingMode);
  const ttsPersonaReadingModeRef = useRef(tts.personaReadingMode);
  ttsCharacterTrackRef.current = tts.characterTrack;
  ttsPersonaTrackRef.current = tts.personaTrack;
  ttsReadingModeRef.current = tts.readingMode;
  ttsPersonaReadingModeRef.current = tts.personaReadingMode;
  const [narratorVoice, setNarratorVoice] = useState<CharacterTtsVoice | null>(null);

  useEffect(() => {
    void window.electronAPI.narratorVoice.get().then(setNarratorVoice);
  }, []);

  useEffect(() => {
    function onFocus() {
      void window.electronAPI.narratorVoice.get().then(setNarratorVoice);
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const session = useChatSession(conversationId ?? null, {
    onUserMessage: (message) => {
      if (ttsPersonaTrackRef.current !== 'auto') return;
      tts.speak(
        message.content,
        {
          speakerVoice: ttsPersonaVoiceRef.current,
          narratorVoice: ttsNarratorVoiceRef.current,
        },
        {
          readingMode: ttsPersonaReadingModeRef.current,
          persist: { messageId: message.id, variantId: null },
        }
      );
    },
    onUserPersisted: (message, optimisticId) => {
      void tts.rebindPersistedAudio(optimisticId, message.id);
    },
    onReplyFinished: (message) => {
      if (ttsCharacterTrackRef.current !== 'auto') return;
      tts.speak(
        message.content,
        {
          speakerVoice: ttsCharacterVoiceRef.current,
          narratorVoice: ttsNarratorVoiceRef.current,
        },
        {
          readingMode: ttsReadingModeRef.current,
          persist: { messageId: message.id, variantId: message.selectedVariantId },
        }
      );
    },
  });

  useEffect(() => {
    tts.setOnAudioSaved((messageId, path, variantId) => session.patchTtsAudio(messageId, path, variantId));
  }, [session.patchTtsAudio, tts.setOnAudioSaved]);

  const latestAssistantMessage = useMemo(() => {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const message = session.messages[i];
      if (message.role === 'assistant' && !message.id.startsWith('pending-')) {
        return message;
      }
    }
    return null;
  }, [session.messages]);

  // Greeting-only drafts stay out of the sidebar and off the Chat tab's return target.
  useEffect(() => {
    if (!conversationId || session.messages.length === 0) return;
    const greetingOnly =
      session.messages.length === 1 && session.messages[0]?.role === 'assistant';
    if (!greetingOnly) setLastConversationId(conversationId);
  }, [conversationId, session.messages]);

  const refreshConversations = useCallback(async () => {
    const all = await window.electronAPI.conversations.getAll();
    // Server filters greeting-only drafts; this matches that rule if main is stale.
    setConversations(all.filter(isCommittedSidebarConversation));
  }, []);

  const discardDraftConversation = useCallback(
    async (id: string) => {
      const { deleted } = await window.electronAPI.conversations.deleteDraft(id);
      if (deleted) {
        if (getLastConversationId() === id) clearLastConversationId();
        setConversations((prev) => prev.filter((c) => c.id !== id));
      }
    },
    []
  );

  const resetStartScreenSelections = useCallback(() => {
    setCharacterId('');
    setPersonaId('');
    setScenarioId('');
    setModel('');
  }, []);

  const openNewChat = useCallback(() => {
    if (conversationId) void discardDraftConversation(conversationId);
    clearSessionActiveConversationId();
    resetStartScreenSelections();
    setSidebarCollapsed(true);
    saveBoolean(SIDEBAR_COLLAPSED_KEY, true);
    navigate('/chat');
  }, [conversationId, discardDraftConversation, resetStartScreenSelections, navigate]);

  const previousConversationIdRef = useRef<string | undefined>(conversationId);
  useEffect(() => {
    const previous = previousConversationIdRef.current;
    previousConversationIdRef.current = conversationId;
    if (previous && previous !== conversationId) {
      void discardDraftConversation(previous);
    }
  }, [conversationId, discardDraftConversation]);

  // Start screen only on first Chat visit this session. After any conversation has been
  // opened, returning to /chat (e.g. via the nav tab) resumes that conversation instead.
  useEffect(() => {
    if (conversationId) {
      setSessionActiveConversationId(conversationId);
      return;
    }

    let cancelled = false;
    void (async () => {
      const sessionId = getSessionActiveConversationId();
      if (sessionId) {
        const conversation = await window.electronAPI.conversations.getById(sessionId);
        if (cancelled) return;
        if (conversation) {
          navigate(`/chat/${sessionId}`, { replace: true });
          return;
        }
        clearSessionActiveConversationId();
      }

      setSidebarCollapsed(true);
      saveBoolean(SIDEBAR_COLLAPSED_KEY, true);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, navigate]);

  useEffect(() => {
    if (!conversationId && model && disabledModels.has(model)) {
      setModel('');
    }
  }, [conversationId, model, disabledModels]);

  const checkOllamaConnection = useCallback(async () => {
    const [result, tuningRows] = await Promise.all([
      window.electronAPI.ollama.listModelsDetailed(),
      window.electronAPI.modelTuning.getAll(),
    ]);
    const disabled = new Set(tuningRows.filter((r) => !r.enabled).map((r) => r.model));
    setDisabledModels(disabled);
    if (result.available) {
      setModelState({ status: 'ready', models: result.models });
      const firstEnabled = result.models.find((m) => !isEmbeddingModel(m) && !disabled.has(m.name));
      setModel((current) => current || firstEnabled?.name || result.models.find((m) => !isEmbeddingModel(m))?.name || '');
    } else {
      setModelState({ status: 'unavailable', message: result.message });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await window.electronAPI.conversations.purgeDrafts(conversationId ?? undefined);
      const [chars, people] = await Promise.all([
        window.electronAPI.characters.getAll(),
        window.electronAPI.personas.getAll(),
      ]);
      setCharacters(chars);
      setPersonas(people);
      await refreshConversations();
      await checkOllamaConnection();
    })();
    // hiddenUnlocked: characters/personas/conversations already fetched under the previous
    // lock state hold ciphertext for anything hidden -- re-fetch on every lock/unlock so
    // content updates immediately instead of only after a manual reload.
  }, [refreshConversations, hiddenUnlocked, checkOllamaConnection, conversationId]);

  useEffect(() => {
    if (modelState.status !== 'unavailable') return;
    const interval = window.setInterval(() => {
      void checkOllamaConnection();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [modelState.status, checkOllamaConnection]);

  // Opening an existing conversation adopts its character, persona, model, and avatar mode.
  useEffect(() => {
    if (!conversationId) return;
    void (async () => {
      const conversation = await window.electronAPI.conversations.getById(conversationId);
      if (!conversation) {
        if (getSessionActiveConversationId() === conversationId) {
          clearSessionActiveConversationId();
        }
        navigate('/chat');
        return;
      }
      if (conversation.characterId) setCharacterId(conversation.characterId);
      setPersonaId(conversation.userPersonaId ?? '');
      setScenarioId(conversation.scenarioId ?? '');
      setModel((current) => conversation.model || current);
      setCharacterImageMode(conversation.characterImageMode);
      setCharacterImageId(conversation.characterImageId);
      setScenarioImageId(conversation.scenarioImageId);
      setPersonaImageMode(conversation.personaImageMode);
      setPersonaImageId(conversation.personaImageId);
      setKeepForever(conversation.keepForever);
    })();
  }, [conversationId, navigate]);

  useEffect(() => {
    setKeepForever(false);
    void window.electronAPI.retention.setActiveConversation(conversationId ?? null);
    return () => {
      void window.electronAPI.retention.setActiveConversation(null);
    };
  }, [conversationId]);

  useEffect(() => {
    return window.electronAPI.retention.onCleaned(({ deletedIds }) => {
      if (deletedIds.length === 0) return;
      void refreshConversations();
      const last = getLastConversationId();
      if (last && deletedIds.includes(last)) clearLastConversationId();
      if (conversationId && deletedIds.includes(conversationId)) {
        clearSessionActiveConversationId();
        navigate('/chat');
      }
    });
  }, [conversationId, navigate, refreshConversations]);

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

  // A character's scenario list, loaded alongside its images -- same convention.
  useEffect(() => {
    if (!characterId) {
      setScenarios([]);
      return;
    }
    void window.electronAPI.scenarios.getByCharacter(characterId).then(setScenarios);
  }, [characterId]);

  useEffect(() => {
    if (scenarioId) {
      void window.electronAPI.scenarioImages.getByScenario(scenarioId).then(setScenarioImages);
      return;
    }
    setScenarioImages([]);
  }, [scenarioId]);

  // Cover galleries for every visible library card -- feeds both the start screen and the
  // mid-conversation persona/model pickers (see personaPickerOptions below), which reuse the
  // same rich StartScreenPicker rather than a plain <select>. The per-selection image loads
  // elsewhere only cover the currently picked character/persona/scenario.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.characterImages.getAllGroupedByCharacter(),
      window.electronAPI.personaImages.getAllGroupedByPersona(),
    ]).then(([characterCovers, personaCovers]) => {
      if (!cancelled) {
        setStartCharacterCovers(characterCovers);
        setStartPersonaCovers(personaCovers);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, hiddenUnlocked]);

  useEffect(() => {
    if (conversationId || scenarios.length === 0) {
      setStartScenarioCoverUrls({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      scenarios.map(async (scenario) => {
        const images = await window.electronAPI.scenarioImages.getByScenario(scenario.id);
        return { id: scenario.id, coverUrl: startScreenPortraitUrl(images) };
      })
    ).then((rows) => {
      if (cancelled) return;
      const coverUrls: Record<string, string | null> = {};
      for (const row of rows) {
        coverUrls[row.id] = row.coverUrl;
      }
      setStartScenarioCoverUrls(coverUrls);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, scenarios, hiddenUnlocked]);

  // Drives the margin portraits' carousel mode -- one shared tick so both sides advance on the
  // same 10-second beat even when their galleries are different sizes (each side just indexes
  // into its own array via tick % length). Only runs while there's something to animate.
  useEffect(() => {
    if (!showPortraits || !conversationId) return;
    const interval = setInterval(() => setCarouselTick((t) => t + 1), 10_000);
    return () => clearInterval(interval);
  }, [showPortraits, conversationId]);

  const character = characters.find((c) => c.id === characterId) ?? null;
  const persona = personas.find((p) => p.id === personaId) ?? null;
  const characterVoice = character?.ttsVoice ?? null;
  const personaVoice = persona?.ttsVoice ?? null;
  const characterSpeechAvailable = Boolean(characterVoice || narratorVoice);
  const personaSpeechAvailable = Boolean(personaVoice || narratorVoice);
  const ttsAvailable = characterSpeechAvailable || personaSpeechAvailable;
  const canSplitCharacter = Boolean(characterVoice && narratorVoice && !voicesMatch(characterVoice, narratorVoice));
  const canSplitPersona = Boolean(personaVoice && narratorVoice && !voicesMatch(personaVoice, narratorVoice));
  ttsCharacterVoiceRef.current = characterVoice;
  ttsPersonaVoiceRef.current = personaVoice;
  ttsNarratorVoiceRef.current = narratorVoice;

  const speakMessage = (
    message: Message,
    opts?: { replace?: boolean; forceGenerate?: boolean; reportErrors?: boolean }
  ) => {
    const isAssistant = message.role === 'assistant';
    tts.speak(
      message.content,
      {
        speakerVoice: isAssistant ? characterVoice : personaVoice,
        narratorVoice,
      },
      {
        reportErrors: opts?.reportErrors ?? true,
        readingMode: isAssistant ? tts.readingMode : tts.personaReadingMode,
        persist: {
          messageId: message.id,
          variantId: isAssistant ? message.selectedVariantId : null,
        },
        savedPath: opts?.forceGenerate ? null : ttsPathForMessage(message, session.variants),
        replace: opts?.replace,
      }
    );
  };

  // Dropdown options and the sidebar list drop hidden entries while locked; a conversation
  // that already has a hidden character/persona selected (opened before locking, or via an
  // old link) still resolves fine above -- only what's offered/listed is filtered here.
  const visibleCharacters = characters.filter((c) => hiddenUnlocked || !c.isHidden);
  const visiblePersonas = personas.filter((p) => hiddenUnlocked || !p.isHidden);
  // Already scoped to the selected character (loaded per characterId, see the effect above).
  const visibleScenarios = scenarios.filter((s) => hiddenUnlocked || !s.isHidden);
  const selectedScenario = scenarios.find((s) => s.id === scenarioId) ?? null;
  const isConversationHidden = (c: Conversation) =>
    Boolean(
      (c.characterId && characters.find((ch) => ch.id === c.characterId)?.isHidden) ||
        (c.userPersonaId && personas.find((p) => p.id === c.userPersonaId)?.isHidden)
    );
  const visibleConversations = conversations.filter(
    (c) => (hiddenUnlocked || !isConversationHidden(c)) && isCommittedSidebarConversation(c)
  );

  const conversationListTitle = (c: ConversationListItem): string => c.scenarioName ?? 'No scenario';

  // Two separate lines rather than one joined string -- a single long "Char · Persona · N
  // messages · date" line wraps unpredictably in the narrow sidebar and can strand a lone
  // "· date" fragment on its own row. Splitting means each row wraps/truncates on its own.
  const conversationListParticipants = (c: ConversationListItem): string => {
    const charName = characters.find((ch) => ch.id === c.characterId)?.name ?? 'Assistant';
    const personaName = c.userPersonaId ? personas.find((p) => p.id === c.userPersonaId)?.name : null;
    return personaName ? `${charName} · ${personaName}` : charName;
  };

  const conversationListStats = (c: ConversationListItem): string => {
    const count = `${c.messageCount} message${c.messageCount === 1 ? '' : 's'}`;
    return `${count} · ${formatConversationListDate(c.lastMessageAt ?? c.updatedAt)}`;
  };

  /**
   * Locked once a conversation has messages, matching the source: the system prompt is built
   * from the character, so swapping mid-conversation would silently change who the model
   * thinks it is halfway through a transcript.
   */
  const selectionLocked = Boolean(conversationId && session.messages.length > 0);

  const startConversation = useCallback(async () => {
    if (!characterId || !personaId || !model) return;
    if (conversationId) await discardDraftConversation(conversationId);
    const conversation = await window.electronAPI.conversations.create({
      characterId,
      model,
      userPersonaId: personaId,
      scenarioId: scenarioId || undefined,
    });
    navigate(`/chat/${conversation.id}`);
  }, [characterId, conversationId, discardDraftConversation, model, personaId, scenarioId, navigate]);

  const handleSend = useCallback(
    async (message: string, directions: string) => {
      if (!characterId || !model) return;
      if (tts.overlapMode === 'interrupt') tts.stop();
      unlockSpeechPlayback();
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
    [characterId, model, personaId, samplers, session, refreshConversations, tts.overlapMode, tts.stop]
  );

  const handleContinue = useCallback(
    async (directions: string) => {
      if (!characterId || !model) return;
      if (tts.overlapMode === 'interrupt') tts.stop();
      unlockSpeechPlayback();
      await session.continueAsCharacter({
        characterId,
        model,
        personaId: personaId || undefined,
        directions: directions || undefined,
        samplers,
      });
      void refreshConversations();
    },
    [characterId, model, personaId, samplers, session, refreshConversations, tts.overlapMode, tts.stop]
  );

  const handleRegenerate = useCallback(() => {
    tts.stop();
    unlockSpeechPlayback();
    void session.regenerate(samplers, model);
  }, [model, samplers, session, tts.stop]);

  const handleSelectVariant = useCallback(
    (variantId: string) => {
      tts.stop();
      unlockSpeechPlayback();
      void session.selectVariant(variantId);
    },
    [session, tts.stop]
  );

  /** Save of the last assistant bubble -- stop speech here, not when the textarea opens. */
  const handleEditLast = useCallback(
    (content: string) => {
      tts.stop();
      void session.editLastMessage(content);
    },
    [session, tts.stop]
  );

  const handleEditPrior = useCallback(
    (messageId: string, content: string) => {
      if (!characterId || !model) return;
      tts.stop();
      void session.editPriorMessage(messageId, content, {
        characterId,
        model,
        personaId: personaId || undefined,
        samplers,
      });
      void refreshConversations();
    },
    [characterId, model, personaId, samplers, session, refreshConversations, tts.stop]
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await window.electronAPI.conversations.delete(id);
      await refreshConversations();
      if (id === conversationId) {
        clearSessionActiveConversationId();
        navigate('/chat');
      }
    },
    [conversationId, navigate, refreshConversations]
  );

  const handleKeepForeverChange = useCallback(
    async (keep: boolean) => {
      if (!conversationId) return;
      setKeepForever(keep);
      const updated = await window.electronAPI.conversations.setKeepForever(conversationId, keep);
      setKeepForever(updated.keepForever);
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, keepForever: updated.keepForever } : c))
      );
    },
    [conversationId]
  );

  const handleFontSizeChange = useCallback((size: ChatFontSize) => {
    setFontSize(size);
    saveChatFontSize(size);
  }, []);

  // Purely cosmetic and not locked by selectionLocked -- picking a specific portrait (or going
  // back to the carousel) is fine mid-conversation since it never touches the model's context.
  // The picker's candidate list is the character's own images plus (while a scenario is
  // selected) that scenario's own images -- characterImageId and scenarioImageId pin the same
  // portrait slot, so picking one clears the other rather than leaving a stale pick sitting
  // alongside the new one.
  const handleCharacterImageChange = useCallback(
    async (value: string) => {
      const mode: ImageMode = value === 'carousel' ? 'carousel' : 'static';
      const isScenarioImage = mode === 'static' && scenarioImages.some((img) => img.id === value);
      const nextCharacterImageId = mode === 'static' && !isScenarioImage ? value : null;
      const nextScenarioImageId = isScenarioImage ? value : null;
      setCharacterImageMode(mode);
      setCharacterImageId(nextCharacterImageId);
      setScenarioImageId(nextScenarioImageId);
      if (conversationId) {
        await window.electronAPI.conversations.setImageMode(conversationId, {
          characterImageMode: mode,
          characterImageId: nextCharacterImageId,
          scenarioImageId: nextScenarioImageId,
        });
      }
    },
    [conversationId, scenarioImages]
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

  // Changes who the user's persona is mid-conversation (one person stepping away, another
  // taking their place) -- history stays exactly as written, since messages and memories
  // already hold literal text rather than a {{user}} placeholder; only the next turn's system
  // prompt picks up whoever is selected now. A stock scene note is dropped into Directions so
  // the model is told about the swap in-narrative instead of just silently addressing someone
  // new -- the user can edit or clear it before sending like any other direction.
  const handlePersonaSwitch = useCallback(
    async (newPersonaId: string) => {
      if (!conversationId || newPersonaId === personaId) return;
      const oldName = persona?.name ?? null;
      const newPersona = newPersonaId ? personas.find((p) => p.id === newPersonaId) ?? null : null;

      await window.electronAPI.conversations.setPersona(conversationId, newPersonaId || null);
      setPersonaId(newPersonaId);
      setPersonaImageMode('carousel');
      setPersonaImageId(null);

      const note = newPersona
        ? oldName
          ? `${oldName} has stepped away, and ${newPersona.name} has taken their place in the conversation -- address ${newPersona.name} accordingly.`
          : `${newPersona.name} has joined the conversation.`
        : oldName
          ? `${oldName} has left the conversation.`
          : '';
      if (note) {
        setDirections(note);
        setDirectionsOpen(true);
      }
    },
    [conversationId, personaId, persona, personas]
  );

  // A conversation involving a hidden character/persona must disappear the instant the app
  // locks (not just drop out of the sidebar list) -- otherwise the already-loaded transcript
  // would keep showing decrypted content on screen after the toggle says locked. Also covers
  // reaching a hidden conversation's URL directly while already locked.
  useEffect(() => {
    if (!hiddenUnlocked && conversationId && (character?.isHidden || persona?.isHidden)) {
      clearSessionActiveConversationId();
      navigate('/chat');
    }
  }, [hiddenUnlocked, conversationId, character, persona, navigate]);

  const installedModels = useMemo(
    () => (modelState.status === 'ready' ? modelState.models : []),
    [modelState]
  );

  // Excludes embedding models (memory-only) and models unchecked from "In Chat" on Model
  // Tuning. Mid-conversation, the active model stays listed even if since disabled so the
  // picker doesn't lose the selection.
  const modelOptions = useMemo(() => {
    if (modelState.status !== 'ready') return [];
    const isChatModel = (m: OllamaModelInfo) => !isEmbeddingModel(m);
    if (!conversationId) {
      return installedModels.filter((m) => isChatModel(m) && !disabledModels.has(m.name));
    }
    return installedModels.filter(
      (m) => isChatModel(m) && (m.name === model || !disabledModels.has(m.name))
    );
  }, [installedModels, disabledModels, model, conversationId, modelState.status]);

  const modelPickerOptions = useMemo(
    () => buildModelPickerOptions(modelOptions, installedModels),
    [modelOptions, installedModels]
  );

  const canChat = Boolean(conversationId && characterId && model);

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

  // The selected scenario's images join the character's own only while that scenario is
  // actually selected for this chat -- not merged in otherwise.
  const mergedCharacterImages = scenarioId ? [...characterImages, ...scenarioImages] : characterImages;
  const characterPortrait = resolveMarginImage(
    mergedCharacterImages,
    characterImageMode,
    characterImageId ?? scenarioImageId,
    carouselTick
  );
  const personaPortrait = resolveMarginImage(personaImages, personaImageMode, personaImageId, carouselTick);

  // Same threshold the old two-row layout used to decide whether the transcript column caps
  // at 900px (leaving room for the two portrait margins) or just fills the available width.
  // Grown rails only apply while a margin portrait is actually rendered -- not merely because
  // the toggle is on (empty portrait slots were still reserving 220px and squeezing the
  // transcript).
  const portraitsActive = Boolean(showPortraits && conversationId);
  const characterMarginPortrait = portraitsActive ? characterPortrait : null;
  const personaMarginPortrait = portraitsActive ? personaPortrait : null;
  const showStartScreen = !conversationId;

  const startCharacterPortraitUrl = useMemo(() => startScreenPortraitUrl(characterImages), [characterImages]);

  const startScenarioPortraitUrl = useMemo(() => {
    if (!scenarioId) return null;
    return startScreenPortraitUrl(scenarioImages);
  }, [scenarioId, scenarioImages]);

  const startPersonaPortraitUrl = useMemo(() => startScreenPortraitUrl(personaImages), [personaImages]);

  const startCharacterCoverUrls = useMemo(() => {
    const urls: Record<string, string | null> = {};
    for (const [id, images] of Object.entries(startCharacterCovers)) {
      urls[id] = startScreenPortraitUrl(images);
    }
    return urls;
  }, [startCharacterCovers]);

  const startPersonaCoverUrls = useMemo(() => {
    const urls: Record<string, string | null> = {};
    for (const [id, images] of Object.entries(startPersonaCovers)) {
      urls[id] = startScreenPortraitUrl(images);
    }
    return urls;
  }, [startPersonaCovers]);

  // Same rich, portrait-and-subtext options the start screen uses (see chatPickerOptions) --
  // the mid-conversation persona switcher and model picker below reuse StartScreenPicker
  // rather than falling back to a plain <select> once a conversation exists.
  const personaPickerOptions = useMemo(
    () => buildPersonaPickerOptions(visiblePersonas, startPersonaCoverUrls),
    [visiblePersonas, startPersonaCoverUrls]
  );

  if (modelState.status === 'loading') {
    return <OllamaSetupLoading />;
  }

  if (modelState.status === 'unavailable') {
    return <ChatOllamaSetup detail={modelState.message} />;
  }

  return (
    <>
      <EmbeddingModelMissingPrompt enabled />
      <div
        className={`chat-page${sidebarCollapsed ? ' sidebar-collapsed' : ''}${rightSidebarOpen ? ' right-sidebar-open' : ''}`}
      >
      {sidebarCollapsed && (
        <button
          type="button"
          className="chat-sidebar-reveal-btn"
          title="Show conversations"
          onClick={toggleSidebarCollapsed}
          aria-expanded="false"
        >
          <ConversationsRevealIcon />
        </button>
      )}
      {conversationId && !rightSidebarOpen && (
        <button
          type="button"
          className="chat-right-sidebar-reveal-btn"
          title="Show settings, memories, and debug"
          onClick={() => {
            setRightSidebarTab('settings');
            setRightSidebarOpen(true);
          }}
          aria-expanded="false"
        >
          <SettingsRevealIcon />
        </button>
      )}
      {!sidebarCollapsed && (
        <aside className="chat-sidebar">
          <div className="chat-sidebar-header">
            <div className="chat-sidebar-header-title">
              <button
                type="button"
                className="chat-sidebar-collapse-btn"
                title="Hide conversations"
                onClick={toggleSidebarCollapsed}
                aria-expanded="true"
              >
                ×
              </button>
              <h2>Conversations</h2>
            </div>
            <button type="button" className="btn btn-primary" onClick={openNewChat}>
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
                <button
                  type="button"
                  onClick={() => {
                    if (conversationId && conversationId !== conversation.id) {
                      void discardDraftConversation(conversationId);
                    }
                    navigate(`/chat/${conversation.id}`);
                  }}
                >
                  <span className="chat-conversation-title">
                    {conversation.keepForever && (
                      <span
                        className="chat-conversation-keep"
                        title="Kept — retention will not delete this chat"
                      >
                        Keep
                      </span>
                    )}
                    <span className="chat-conversation-title-text">
                      {conversationListTitle(conversation)}
                    </span>
                  </span>
                  <span className="chat-conversation-meta">
                    {conversationListParticipants(conversation)}
                  </span>
                  <span className="chat-conversation-meta">{conversationListStats(conversation)}</span>
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
      )}

      <section ref={chatMainRef} className={`chat-main${showStartScreen ? ' chat-main-start' : ''}`}>

        {showStartScreen ? (
          <ChatStartScreen
            characters={visibleCharacters}
            personas={visiblePersonas}
            scenarios={visibleScenarios}
            modelPickerOptions={modelPickerOptions}
            modelsReady={modelState.status === 'ready'}
            characterId={characterId}
            personaId={personaId}
            scenarioId={scenarioId}
            model={model}
            characterPortraitUrl={startCharacterPortraitUrl}
            personaPortraitUrl={startPersonaPortraitUrl}
            scenarioPortraitUrl={startScenarioPortraitUrl}
            characterCoverUrls={startCharacterCoverUrls}
            personaCoverUrls={startPersonaCoverUrls}
            scenarioCoverUrls={startScenarioCoverUrls}
            onCharacterChange={(id) => {
              setCharacterId(id);
              setScenarioId('');
            }}
            onPersonaChange={setPersonaId}
            onScenarioChange={setScenarioId}
            onModelChange={setModel}
            onStart={() => void startConversation()}
          />
        ) : (
          <>
        <div
          className={`chat-columns${portraitsActive ? '' : ' chat-columns-no-margins'}`}
          style={{ '--chat-bubble-font-size': `${fontSize}px` } as React.CSSProperties}
        >
          {portraitsActive && (
          <div className="chat-column chat-column-side chat-column-side-grown">
            <div className="chat-column-header">
              {selectionLocked ? (
                // Can't be changed once the conversation has real turns in it -- the transcript
                // is already written from this character's point of view, so a dropdown here
                // would just offer a choice that can't actually be made. Plain text instead.
                <div className="chat-header-static">
                  <span className="chat-header-static-value">{character?.name ?? '—'}</span>
                  <CastDescription text={character?.description} />
                </div>
              ) : (
                <label>
                  Character
                  <select
                    value={characterId}
                    onChange={(e) => {
                      setCharacterId(e.target.value);
                      setScenarioId('');
                    }}
                  >
                    <option value="">Select…</option>
                    {visibleCharacters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <CastDescription text={character?.description} />
                </label>
              )}
            </div>

            {characterMarginPortrait && (
              <div className="chat-portrait-margin">
                <img src={toImageUrl(characterMarginPortrait.path)} alt={character?.name ?? ''} />
                {conversationId && mergedCharacterImages.length > 0 && (
                  <ImagePickerSelect
                    label="Character image"
                    images={mergedCharacterImages}
                    mode={characterImageMode}
                    staticId={characterImageId ?? scenarioImageId}
                    onChange={(value) => void handleCharacterImageChange(value)}
                    overlay
                  />
                )}
              </div>
            )}
          </div>
          )}

          {/* Center column: banners up top, the transcript filling the rest, then the
              composer, then the model/memories/debug/more controls. Side margin columns (and
              their image pickers) only render while Show portraits is on. */}
          <div
            className={`chat-column chat-column-center${portraitsActive ? ' chat-column-center-capped' : ''}`}
          >
            {selectedScenario && (
              <header
                className={`chat-scenario-header${portraitsActive ? ' chat-scenario-header-cast' : ''}`}
              >
                <span className="chat-scenario-header-title">{selectedScenario.name}</span>
                <CastDescription text={selectedScenario.description} />
              </header>
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
              <MessageList
                  messages={session.messages}
                  streamingText={session.streamingText}
                  isGenerating={session.isGenerating}
                  isRegenerating={session.isRegenerating}
                  variants={session.variants}
                  onRegenerate={handleRegenerate}
                  onSelectVariant={handleSelectVariant}
                  onEditLast={handleEditLast}
                  onEditPrior={handleEditPrior}
                  onDeleteLast={() => void session.deleteLastMessage()}
                  onViewPrompt={(messageId) => void handleViewPrompt(messageId)}
                  onContinue={
                    canChat
                      ? () => {
                          unlockSpeechPlayback();
                          void handleContinue(directions);
                          setDirections('');
                          setDirectionsOpen(false);
                        }
                      : undefined
                  }
                  characterName={character?.name ?? 'Assistant'}
                  personaName={persona?.name ?? 'You'}
                  characterImages={characterImages}
                  personaImages={personaImages}
                  tts={
                    ttsAvailable
                      ? {
                          characterTrack: tts.characterTrack,
                          personaTrack: tts.personaTrack,
                          characterAvailable: characterSpeechAvailable,
                          personaAvailable: personaSpeechAvailable,
                          activeMessageId: tts.activeMessageId,
                          activeVariantId: tts.activeVariantId,
                          generating: tts.generating,
                          playing: tts.playing,
                          paused: tts.paused,
                          analyser: tts.analyser,
                          onPlay: (message) => {
                            const variantId = message.selectedVariantId ?? null;
                            if (
                              tts.activeMessageId === message.id &&
                              tts.activeVariantId === variantId &&
                              tts.paused
                            ) {
                              tts.resume();
                              return;
                            }
                            speakMessage(message, { replace: true });
                          },
                          onPause: tts.pause,
                          onGenerate: (message) =>
                            speakMessage(message, { replace: true, forceGenerate: true }),
                        }
                      : undefined
                  }
                />

              <Composer
                disabled={!canChat}
                isGenerating={session.isGenerating}
                directions={directions}
                onDirectionsChange={setDirections}
                directionsOpen={directionsOpen}
                onDirectionsOpenChange={setDirectionsOpen}
                onSend={(message, msgDirections) => void handleSend(message, msgDirections)}
                onSkipDialogue={
                  ttsAvailable &&
                  tts.overlapMode === 'queue' &&
                  (tts.playing || tts.paused || tts.generating) &&
                  ((characterSpeechAvailable && tts.characterTrack !== 'off') ||
                    (personaSpeechAvailable && tts.personaTrack !== 'off'))
                    ? tts.skip
                    : undefined
                }
                skipDialogueReady
                onCancel={() => {
                  tts.stop();
                  void session.cancel();
                }}
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
                modelPicker={
                  <StartScreenPicker
                    className="start-screen-picker-compact start-screen-picker-toolbar"
                    value={model}
                    // Unlike character/persona, the model can change freely mid-conversation --
                    // each turn already carries its own model, so switching doesn't disturb
                    // anything already said, only what generates next.
                    onChange={setModel}
                    options={modelPickerOptions}
                    placeholder={modelState.status !== 'ready' ? '—' : 'Select model…'}
                    disabled={modelState.status !== 'ready'}
                    ariaLabel="Model"
                  />
                }
                messageCount={
                  conversationId ? (
                    <span className="chat-message-count text-muted">
                      {session.messages.length} message{session.messages.length === 1 ? '' : 's'}
                    </span>
                  ) : null
                }
              />

              {tts.error && (
                <p className="chat-tts-error text-muted">
                  {tts.error}{' '}
                  <button type="button" className="btn" onClick={tts.dismissError}>
                    Dismiss
                  </button>
                </p>
              )}

            </div>
          </div>

          {portraitsActive && (
          <div className="chat-column chat-column-side chat-column-side-grown">
            <div className="chat-column-header">
              {selectionLocked ? (
                <div className="chat-header-static">
                  <span className="chat-header-static-value">{persona?.name ?? 'None'}</span>
                  <CastDescription text={persona?.description} />
                </div>
              ) : (
                <div className="chat-settings-persona-picker">
                  <span className="chat-settings-picker-label">Persona</span>
                  <StartScreenPicker
                    value={personaId}
                    onChange={setPersonaId}
                    options={personaPickerOptions}
                    placeholder="Select…"
                    ariaLabel="Persona"
                  />
                </div>
              )}
            </div>

            {personaMarginPortrait && (
              <div className="chat-portrait-margin chat-portrait-margin-persona">
                <img src={toImageUrl(personaMarginPortrait.path)} alt={persona?.name ?? ''} />
                {conversationId && personaImages.length > 0 && (
                  <ImagePickerSelect
                    label="Persona image"
                    images={personaImages}
                    mode={personaImageMode}
                    staticId={personaImageId}
                    onChange={(value) => void handlePersonaImageChange(value)}
                    overlay
                  />
                )}
              </div>
            )}
          </div>
          )}
        </div>

        {promptDialogOpen && (
          <MessagePromptDialog
            debug={promptDialogDebug}
            loading={promptDialogLoading}
            onClose={() => setPromptDialogOpen(false)}
          />
        )}

          </>
        )}
      </section>

      {rightSidebarOpen && conversationId && (
        <ChatRightSidebar
          tab={rightSidebarTab}
          onTabChange={setRightSidebarTab}
          onClose={() => setRightSidebarOpen(false)}
          conversationId={conversationId}
          memoryCount={session.memoryCount}
          debugHistory={session.debugHistory}
          debugHistoryLoading={session.debugHistoryLoading}
          liveDebug={session.debug}
          liveMessageId={latestAssistantMessage?.id ?? null}
          liveCreatedAt={latestAssistantMessage?.createdAt ?? null}
          isGenerating={session.isGenerating}
          onMemoriesChanged={() => void session.refreshMemoryCount()}
          settingsPanel={
            <ChatSettingsPanel
              fontSize={fontSize}
              onFontSizeChange={handleFontSizeChange}
              conversationId={conversationId}
              personaId={personaId}
              onPersonaChange={(id) => void handlePersonaSwitch(id)}
              personaPickerOptions={personaPickerOptions}
              showPortraitsToggle={characterImages.length > 0 || personaImages.length > 0}
              showPortraits={showPortraits}
              portraitsTooNarrow={portraitsTooNarrow}
              onShowPortraitsChange={handleShowPortraitsChange}
              characterSpeechAvailable={characterSpeechAvailable}
              personaSpeechAvailable={personaSpeechAvailable}
              characterTrack={tts.characterTrack}
              onCharacterTrackChange={tts.setCharacterTrack}
              readingMode={tts.readingMode}
              onReadingModeChange={tts.setReadingMode}
              personaTrack={tts.personaTrack}
              onPersonaTrackChange={tts.setPersonaTrack}
              personaReadingMode={tts.personaReadingMode}
              onPersonaReadingModeChange={tts.setPersonaReadingMode}
              overlapMode={tts.overlapMode}
              onOverlapModeChange={tts.setOverlapMode}
              narratorVoice={narratorVoice}
              canSplitCharacter={canSplitCharacter}
              canSplitPersona={canSplitPersona}
              samplers={samplers}
              defaultSamplers={defaultSamplers}
              onSamplersChange={setSamplers}
              keepForever={keepForever}
              onKeepForeverChange={(keep) => void handleKeepForeverChange(keep)}
            />
          }
        />
      )}
    </div>
    </>
  );
}
