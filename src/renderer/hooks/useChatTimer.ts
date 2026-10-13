import { useEffect, useState } from 'react';
import { ActiveTimeClock } from '../../shared/utils/activeTimeClock';

/** How often the unsaved seconds are sent to the main process. */
const FLUSH_EVERY_MS = 15000;

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;

export interface ChatTimer {
  /** Total active seconds in this conversation, across every visit. Null until it has loaded. */
  seconds: number | null;
  /** False while paused (no input for a couple of minutes, or the window is hidden). */
  running: boolean;
}

/**
 * Time actually spent in a chat: counts while there is mouse/keyboard/scroll input in the window and
 * pauses after `CHAT_IDLE_MS` without it (see ActiveTimeClock). The total lives on the conversation
 * row, so it carries across visits and restarts; the page adds to it every few seconds and when it
 * leaves the chat. Always tracked, whether or not the timer is shown.
 */
export function useChatTimer(conversationId: string | undefined): ChatTimer {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    setSeconds(null);
    if (!conversationId) return;

    let cancelled = false;
    let loaded = false;
    let baseSeconds = 0;
    let unsavedMs = 0;
    const clock = new ActiveTimeClock(Date.now());

    const show = () => {
      if (loaded && !cancelled) setSeconds(baseSeconds + Math.floor(unsavedMs / 1000));
    };

    const flush = () => {
      const whole = Math.floor(unsavedMs / 1000);
      if (whole <= 0) return;
      unsavedMs -= whole * 1000;
      baseSeconds += whole;
      void window.electronAPI.conversations.addActiveSeconds(conversationId, whole).catch(() => {
        // A lost flush costs at most a few seconds of the total; nothing to surface.
      });
    };

    void window.electronAPI.conversations.getById(conversationId).then((conversation) => {
      if (cancelled || !conversation) return;
      baseSeconds = conversation.activeSeconds ?? 0;
      loaded = true;
      show();
    });

    const onActivity = () => clock.noteActivity(Date.now());
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    // Scrolling a transcript doesn't bubble, so listen on the capture phase.
    window.addEventListener('scroll', onActivity, { capture: true, passive: true });

    const tick = window.setInterval(() => {
      const now = Date.now();
      unsavedMs += clock.tick(now, document.visibilityState === 'visible');
      setRunning(clock.isActive(now) && document.visibilityState === 'visible');
      show();
    }, 1000);
    const save = window.setInterval(flush, FLUSH_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', flush);

    return () => {
      cancelled = true;
      flush();
      window.clearInterval(tick);
      window.clearInterval(save);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', flush);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      window.removeEventListener('scroll', onActivity, { capture: true });
    };
  }, [conversationId]);

  return { seconds, running };
}
