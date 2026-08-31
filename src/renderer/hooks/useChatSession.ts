import { useCallback, useEffect, useRef, useState } from 'react';
import { Message, MessageVariant } from '../../shared/types/message';
import { ChatDebugHistoryEntry, ChatDebugInfo, ChatStreamEvent, SamplerParams } from '../../shared/types/chat';

/**
 * Owns one conversation's live state: the persisted transcript, the reply currently
 * streaming in, and whatever the last turn recorded for the debug console.
 *
 * This is the first shared client-side layer in the app -- the existing pages call
 * `window.electronAPI` directly from effects, which is fine for request/response but not for
 * something with a subscription, a partial reply and a cancel button. Deliberately not
 * retrofitted onto the other pages.
 */
export interface UseChatSession {
  messages: Message[];
  /** The reply as it arrives; empty when idle. Rendered as a provisional trailing bubble on a
   * fresh send, or in place of the last message's stored content while regenerating it. */
  streamingText: string;
  isGenerating: boolean;
  /** True only while a redo is in flight -- distinct from isGenerating so the transcript knows
   * to replace the last bubble in place rather than append a new one underneath it. */
  isRegenerating: boolean;
  /** Set on a failed turn. Never persisted -- see the note on error handling in chatSession. */
  error: string | null;
  debug: ChatDebugInfo | null;
  /** Every turn's logged prompt for this conversation, oldest first -- backs the Prompt
   * Debugging pane's history list. Refetched (not incrementally patched) whenever a turn
   * finishes, since a redo replaces its entry's content without adding a new message. */
  debugHistory: ChatDebugHistoryEntry[];
  /** True while the persisted prompt history is being loaded from the database. */
  debugHistoryLoading: boolean;
  /** Redo candidates for the last message, when it's an assistant turn. Empty for everything
   * else, including a message that predates redo support. */
  variants: MessageVariant[];
  /** How many memories this conversation has stored. Kept here rather than in the dialog so
   * the badge is live even while the dialog is closed -- extraction lands between turns. */
  memoryCount: number;
  refreshMemoryCount: () => Promise<void>;
  send: (input: SendInput) => Promise<void>;
  /** Appends another assistant message with no new user message first -- lets the character
   * take a second turn on its own. Streams and appends exactly like `send`, just without the
   * optimistic user bubble (there's no new user message to show). */
  continueAsCharacter: (input: ContinueInput) => Promise<void>;
  /** Generates another variant of the last response, using the same context it was answering.
   * Selected automatically once it lands -- nothing is folded into context or extracted until
   * the next `send`, whichever variant happens to be selected then. */
  regenerate: (samplers?: Partial<SamplerParams>, model?: string) => Promise<void>;
  /** Switches which variant of the last message is shown. Instant -- no model call. */
  selectVariant: (variantId: string) => Promise<void>;
  /** Hand-edits the last message's content -- assistant only, see chatSession.editMessage.
   * Records the edit as a new variant rather than overwriting, so the original stays reachable
   * through the same variant switcher a redo would leave behind. */
  editLastMessage: (content: string) => Promise<void>;
  /** Rewrites the user message behind the pending reply and regenerates that reply against the
   * new text -- see chatSession.editPriorUserMessage. Only valid for that one message; anything
   * earlier already has a reply after it. */
  editPriorMessage: (messageId: string, content: string, input: ContinueInput) => Promise<void>;
  /** Deletes the conversation's last message (LIFO -- see conversationService.deleteMessage).
   * Any memories extracted from it go with it. */
  deleteLastMessage: () => Promise<void>;
  /** Patches a stored spoken-audio path onto a message, and onto the matching redo
   * variant when given. A late save from an older variant must not land on a newer one. */
  patchTtsAudio: (messageId: string, path: string | null, variantId?: string | null) => void;
  cancel: () => Promise<void>;
  dismissError: () => void;
  reload: () => Promise<void>;
}

export interface SendInput {
  characterId: string;
  model: string;
  message: string;
  personaId?: string;
  directions?: string;
  samplers?: Partial<SamplerParams>;
}

/** Same shape as SendInput minus `message` -- see UseChatSession.continueAsCharacter. */
export type ContinueInput = Omit<SendInput, 'message'>;

export function useChatSession(
  conversationId: string | null,
  options?: {
    onReplyFinished?: (message: Message) => void;
    onUserMessage?: (message: Message) => void;
    onUserPersisted?: (message: Message, optimisticId: string) => void;
  }
): UseChatSession {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<ChatDebugInfo | null>(null);
  const [debugHistory, setDebugHistory] = useState<ChatDebugHistoryEntry[]>([]);
  const [debugHistoryLoading, setDebugHistoryLoading] = useState(false);
  const [variants, setVariants] = useState<MessageVariant[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);

  // The stream we're currently listening for. Events for any other stream are ignored, so a
  // stale reply from a conversation the user just switched away from can't bleed in.
  const activeStreamId = useRef<string | null>(null);

  // The onStream effect below subscribes once (empty deps) and outlives conversation switches,
  // so it reads refreshDebugHistory through a ref rather than closing over a version tied to
  // whichever conversationId was active when it first mounted.
  const refreshDebugHistoryRef = useRef<() => Promise<void>>(async () => {});
  const onReplyFinishedRef = useRef(options?.onReplyFinished);
  onReplyFinishedRef.current = options?.onReplyFinished;
  const onUserMessageRef = useRef(options?.onUserMessage);
  onUserMessageRef.current = options?.onUserMessage;
  const onUserPersistedRef = useRef(options?.onUserPersisted);
  onUserPersistedRef.current = options?.onUserPersisted;
  const pendingUserOptimisticIdRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setMessages(await window.electronAPI.conversations.getMessages(conversationId));
  }, [conversationId]);

  const refreshMemoryCount = useCallback(async () => {
    if (!conversationId) {
      setMemoryCount(0);
      return;
    }
    setMemoryCount(await window.electronAPI.memories.count(conversationId));
  }, [conversationId]);

  const refreshDebugHistory = useCallback(async () => {
    if (!conversationId) {
      setDebugHistory([]);
      setDebugHistoryLoading(false);
      return;
    }
    setDebugHistoryLoading(true);
    try {
      setDebugHistory(await window.electronAPI.chat.getDebugHistory(conversationId));
    } finally {
      setDebugHistoryLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    refreshDebugHistoryRef.current = refreshDebugHistory;
  }, [refreshDebugHistory]);

  useEffect(() => {
    void refreshMemoryCount();
  }, [refreshMemoryCount]);

  // Extraction runs after the reply has already been delivered, so the count arrives on its
  // own channel rather than in the turn's response.
  useEffect(() => {
    const unsubscribe = window.electronAPI.chat.onMemoriesUpdated((payload) => {
      if (payload.conversationId === conversationId) void refreshMemoryCount();
    });
    return unsubscribe;
  }, [conversationId, refreshMemoryCount]);

  useEffect(() => {
    void reload();
    setDebugHistory([]);
    setDebugHistoryLoading(!!conversationId);
    void refreshDebugHistory();
    setStreamingText('');
    setError(null);
    setDebug(null);
    setVariants([]);
    setIsRegenerating(false);
    activeStreamId.current = null;
  }, [conversationId, reload, refreshDebugHistory]);

  // Redo candidates exist only for the last message, and only when it's a real (persisted)
  // assistant turn -- an optimistic user row or a mid-stream reply has no id to look up yet.
  // Keyed on selected variant, not the whole messages array: a TTS path patch must not
  // refetch and clobber the variant list we just updated.
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (lastMessage?.role === 'assistant' && !lastMessage.id.startsWith('pending-')) {
      let cancelled = false;
      void window.electronAPI.chat.getVariants(lastMessage.id).then((next) => {
        if (!cancelled) setVariants(next);
      });
      return () => {
        cancelled = true;
      };
    }
    setVariants([]);
  }, [lastMessage?.id, lastMessage?.role, lastMessage?.selectedVariantId]);

  useEffect(() => {
    // onStream hands back an unsubscribe closure; returning it from the effect is what stops
    // a listener leaking on every remount.
    const unsubscribe = window.electronAPI.chat.onStream((event: ChatStreamEvent) => {
      if (event.streamId !== activeStreamId.current) return;

      switch (event.type) {
        case 'token':
          setStreamingText((current) => current + event.text);
          break;
        case 'done':
          setMessages((current) => {
            // Swap the optimistic (fake-id) user row for the real, DB-backed one before
            // appending the reply -- otherwise that fake id lingers in state until the next
            // full reload, which breaks anything that needs to address this message by id
            // (e.g. editing it later).
            const withRealUser = event.userMessage
              ? current.map((m) =>
                  m.id.startsWith('pending-')
                    ? {
                        ...event.userMessage!,
                        ttsAudioPath: m.ttsAudioPath ?? event.userMessage!.ttsAudioPath,
                      }
                    : m
                )
              : current;
            return [...withRealUser, event.message];
          });
          setDebug(event.debug);
          setStreamingText('');
          setIsGenerating(false);
          activeStreamId.current = null;
          void refreshDebugHistoryRef.current();
          if (event.userMessage && pendingUserOptimisticIdRef.current) {
            onUserPersistedRef.current?.(event.userMessage, pendingUserOptimisticIdRef.current);
            pendingUserOptimisticIdRef.current = null;
          }
          onReplyFinishedRef.current?.(event.message);
          break;
        case 'variantDone':
          setMessages((current) => {
            const withRealUser = event.userMessage
              ? current.map((m) =>
                  m.id === event.userMessage!.id || m.id.startsWith('pending-')
                    ? {
                        ...event.userMessage!,
                        ttsAudioPath: m.ttsAudioPath ?? event.userMessage!.ttsAudioPath,
                      }
                    : m
                )
              : current;
            return withRealUser.map((m) => (m.id === event.message.id ? event.message : m));
          });
          setDebug(event.debug);
          setStreamingText('');
          setIsGenerating(false);
          setIsRegenerating(false);
          activeStreamId.current = null;
          void refreshDebugHistoryRef.current();
          if (event.userMessage && pendingUserOptimisticIdRef.current) {
            onUserPersistedRef.current?.(event.userMessage, pendingUserOptimisticIdRef.current);
            pendingUserOptimisticIdRef.current = null;
          }
          onReplyFinishedRef.current?.(event.message);
          break;
        case 'error':
          setError(event.message);
          setStreamingText('');
          setIsGenerating(false);
          setIsRegenerating(false);
          activeStreamId.current = null;
          break;
        case 'cancelled':
          setStreamingText('');
          setIsGenerating(false);
          setIsRegenerating(false);
          activeStreamId.current = null;
          break;
      }
    });

    return unsubscribe;
  }, []);

  const send = useCallback(
    async (input: SendInput) => {
      if (!conversationId || isGenerating || !input.message.trim()) return;

      setError(null);
      setStreamingText('');
      setIsGenerating(true);

      // Show the user's turn immediately rather than waiting for the round trip. The main
      // process persists it before generating, so this optimistic row is replaced by the
      // real one on the next reload rather than being invented.
      const optimistic: Message = {
        id: `pending-${Date.now()}`,
        conversationId,
        role: 'user',
        content: input.message,
        selectedVariantId: null,
        model: null,
        ttsAudioPath: null,
        seq: Number.MAX_SAFE_INTEGER,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);
      pendingUserOptimisticIdRef.current = optimistic.id;
      onUserMessageRef.current?.(optimistic);

      try {
        const { streamId } = await window.electronAPI.chat.send({
          conversationId,
          characterId: input.characterId,
          model: input.model,
          message: input.message,
          personaId: input.personaId,
          directions: input.directions,
          samplers: input.samplers,
        });
        activeStreamId.current = streamId;
      } catch (sendError) {
        // The invoke itself failed, so no stream will ever arrive and no terminal event is
        // coming -- clear the generating flag here or the UI stays stuck.
        setError((sendError as Error).message);
        setIsGenerating(false);
        activeStreamId.current = null;
      }
    },
    [conversationId, isGenerating]
  );

  const continueAsCharacter = useCallback(
    async (input: ContinueInput) => {
      if (!conversationId || isGenerating) return;

      setError(null);
      setStreamingText('');
      setIsGenerating(true);

      // No optimistic bubble to add -- unlike send(), there's no new user message, just the
      // character's own next line once it streams in via the 'done' handler above.
      try {
        const { streamId } = await window.electronAPI.chat.continue({
          conversationId,
          characterId: input.characterId,
          model: input.model,
          personaId: input.personaId,
          directions: input.directions,
          samplers: input.samplers,
        });
        activeStreamId.current = streamId;
      } catch (continueError) {
        setError((continueError as Error).message);
        setIsGenerating(false);
        activeStreamId.current = null;
      }
    },
    [conversationId, isGenerating]
  );

  const regenerate = useCallback(
    async (samplers?: Partial<SamplerParams>, model?: string) => {
      if (!conversationId || isGenerating) return;

      setError(null);
      setStreamingText('');
      setIsGenerating(true);
      setIsRegenerating(true);

      try {
        const { streamId } = await window.electronAPI.chat.regenerate({ conversationId, samplers, model });
        activeStreamId.current = streamId;
      } catch (regenerateError) {
        setError((regenerateError as Error).message);
        setIsGenerating(false);
        setIsRegenerating(false);
        activeStreamId.current = null;
      }
    },
    [conversationId, isGenerating]
  );

  const selectVariant = useCallback(
    async (variantId: string) => {
      if (!conversationId) return;
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return;

      const updated = await window.electronAPI.chat.selectVariant(conversationId, last.id, variantId);
      setMessages((current) => current.map((m) => (m.id === updated.id ? updated : m)));
    },
    [conversationId, messages]
  );

  const editLastMessage = useCallback(
    async (content: string) => {
      if (!conversationId) return;
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return;

      try {
        const updated = await window.electronAPI.chat.editMessage(conversationId, last.id, content);
        setMessages((current) => current.map((m) => (m.id === updated.id ? updated : m)));
      } catch (editError) {
        setError((editError as Error).message);
      }
    },
    [conversationId, messages]
  );

  const editPriorMessage = useCallback(
    async (messageId: string, content: string, input: ContinueInput) => {
      if (!conversationId || isGenerating || !content.trim()) return;

      setError(null);
      setStreamingText('');
      setIsGenerating(true);
      setIsRegenerating(true);

      // Show the new wording immediately, same optimistic-update convention `send` uses --
      // the 'variantDone' handler reconciles this with the trimmed, persisted version once it
      // lands.
      setMessages((current) => current.map((m) => (m.id === messageId ? { ...m, content, ttsAudioPath: null } : m)));

      try {
        const { streamId } = await window.electronAPI.chat.editPriorMessage({
          conversationId,
          messageId,
          message: content,
          characterId: input.characterId,
          model: input.model,
          personaId: input.personaId,
          directions: input.directions,
          samplers: input.samplers,
        });
        activeStreamId.current = streamId;
      } catch (editError) {
        setError((editError as Error).message);
        setIsGenerating(false);
        setIsRegenerating(false);
        activeStreamId.current = null;
      }
    },
    [conversationId, isGenerating]
  );

  const deleteLastMessage = useCallback(async () => {
    if (!conversationId || isGenerating) return;
    const last = messages[messages.length - 1];
    if (!last || last.id.startsWith('pending-')) return;

    await window.electronAPI.chat.deleteMessage(conversationId, last.id);
    await reload();
    setDebug(null);
    void refreshDebugHistory();
    // Deleting a message cascades to any memories it produced -- the badge count is stale
    // until this refreshes, the same as after extraction adds one.
    void refreshMemoryCount();
  }, [conversationId, isGenerating, messages, reload, refreshMemoryCount, refreshDebugHistory]);

  const cancel = useCallback(async () => {
    if (!conversationId) return;
    await window.electronAPI.chat.cancel(conversationId);
  }, [conversationId]);

  const dismissError = useCallback(() => setError(null), []);

  const patchTtsAudio = useCallback((messageId: string, path: string | null, variantId?: string | null) => {
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== messageId) return m;
        if (m.role === 'assistant' && variantId && m.selectedVariantId && m.selectedVariantId !== variantId) {
          return m;
        }
        return { ...m, ttsAudioPath: path };
      })
    );
    if (variantId) {
      setVariants((current) => current.map((v) => (v.id === variantId ? { ...v, ttsAudioPath: path } : v)));
    }
  }, []);

  return {
    messages,
    streamingText,
    isGenerating,
    isRegenerating,
    error,
    debug,
    debugHistory,
    debugHistoryLoading,
    variants,
    memoryCount,
    refreshMemoryCount,
    send,
    continueAsCharacter,
    regenerate,
    selectVariant,
    editLastMessage,
    editPriorMessage,
    deleteLastMessage,
    patchTtsAudio,
    cancel,
    dismissError,
    reload,
  };
}
