import { useCallback, useEffect, useRef, useState } from 'react';
import { Message, MessageVariant } from '../../shared/types/message';
import { ChatDebugInfo, ChatStreamEvent, SamplerParams } from '../../shared/types/chat';

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
  /** Redo candidates for the last message, when it's an assistant turn. Empty for everything
   * else, including a message that predates redo support. */
  variants: MessageVariant[];
  /** How many memories this conversation has stored. Kept here rather than in the dialog so
   * the badge is live even while the dialog is closed -- extraction lands between turns. */
  memoryCount: number;
  refreshMemoryCount: () => Promise<void>;
  send: (input: SendInput) => Promise<void>;
  /** Generates another variant of the last response, using the same context it was answering.
   * Selected automatically once it lands -- nothing is folded into context or extracted until
   * the next `send`, whichever variant happens to be selected then. */
  regenerate: (samplers?: Partial<SamplerParams>, model?: string) => Promise<void>;
  /** Switches which variant of the last message is shown. Instant -- no model call. */
  selectVariant: (variantId: string) => Promise<void>;
  /** Deletes the conversation's last message (LIFO -- see conversationService.deleteMessage).
   * Any memories extracted from it go with it. */
  deleteLastMessage: () => Promise<void>;
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

export function useChatSession(conversationId: string | null): UseChatSession {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<ChatDebugInfo | null>(null);
  const [variants, setVariants] = useState<MessageVariant[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);

  // The stream we're currently listening for. Events for any other stream are ignored, so a
  // stale reply from a conversation the user just switched away from can't bleed in.
  const activeStreamId = useRef<string | null>(null);

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
    setStreamingText('');
    setError(null);
    setDebug(null);
    setVariants([]);
    setIsRegenerating(false);
    activeStreamId.current = null;
  }, [conversationId, reload]);

  // Redo candidates exist only for the last message, and only when it's a real (persisted)
  // assistant turn -- an optimistic user row or a mid-stream reply has no id to look up yet.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && !last.id.startsWith('pending-')) {
      void window.electronAPI.chat.getVariants(last.id).then(setVariants);
    } else {
      setVariants([]);
    }
  }, [messages]);

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
          setMessages((current) => [...current, event.message]);
          setDebug(event.debug);
          setStreamingText('');
          setIsGenerating(false);
          activeStreamId.current = null;
          break;
        case 'variantDone':
          setMessages((current) =>
            current.map((m) => (m.id === event.message.id ? event.message : m))
          );
          setDebug(event.debug);
          setStreamingText('');
          setIsGenerating(false);
          setIsRegenerating(false);
          activeStreamId.current = null;
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
        seq: Number.MAX_SAFE_INTEGER,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);

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

  const deleteLastMessage = useCallback(async () => {
    if (!conversationId || isGenerating) return;
    const last = messages[messages.length - 1];
    if (!last || last.id.startsWith('pending-')) return;

    await window.electronAPI.chat.deleteMessage(conversationId, last.id);
    await reload();
    setDebug(null);
    // Deleting a message cascades to any memories it produced -- the badge count is stale
    // until this refreshes, the same as after extraction adds one.
    void refreshMemoryCount();
  }, [conversationId, isGenerating, messages, reload, refreshMemoryCount]);

  const cancel = useCallback(async () => {
    if (!conversationId) return;
    await window.electronAPI.chat.cancel(conversationId);
  }, [conversationId]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    messages,
    streamingText,
    isGenerating,
    isRegenerating,
    error,
    debug,
    variants,
    memoryCount,
    refreshMemoryCount,
    send,
    regenerate,
    selectVariant,
    deleteLastMessage,
    cancel,
    dismissError,
    reload,
  };
}
