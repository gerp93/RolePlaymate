import { useCallback, useEffect, useRef, useState } from 'react';
import { Message } from '../../shared/types/message';
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
  /** The reply as it arrives; empty when idle. Rendered as a provisional trailing bubble. */
  streamingText: string;
  isGenerating: boolean;
  /** Set on a failed turn. Never persisted -- see the note on error handling in chatSession. */
  error: string | null;
  debug: ChatDebugInfo | null;
  /** How many memories this conversation has stored. Kept here rather than in the dialog so
   * the badge is live even while the dialog is closed -- extraction lands between turns. */
  memoryCount: number;
  refreshMemoryCount: () => Promise<void>;
  send: (input: SendInput) => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<ChatDebugInfo | null>(null);
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
    activeStreamId.current = null;
  }, [conversationId, reload]);

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
        case 'error':
          setError(event.message);
          setStreamingText('');
          setIsGenerating(false);
          activeStreamId.current = null;
          break;
        case 'cancelled':
          setStreamingText('');
          setIsGenerating(false);
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

  const cancel = useCallback(async () => {
    if (!conversationId) return;
    await window.electronAPI.chat.cancel(conversationId);
  }, [conversationId]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    messages,
    streamingText,
    isGenerating,
    error,
    debug,
    memoryCount,
    refreshMemoryCount,
    send,
    cancel,
    dismissError,
    reload,
  };
}
