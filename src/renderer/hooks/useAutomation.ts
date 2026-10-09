import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AutomationPhase,
  AutomationRunSummary,
  AutomationStartRequest,
} from '../../shared/types/automation';

export interface UseAutomation {
  /** The run in flight, if any -- app-wide, not only this conversation's. */
  active: AutomationRunSummary | null;
  phase: AutomationPhase;
  /** True while a run is writing into the conversation this hook was given. */
  automatingHere: boolean;
  runs: AutomationRunSummary[];
  error: string | null;
  start: (request: AutomationStartRequest) => Promise<void>;
  stop: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  dismissError: () => void;
}

/**
 * Live state for automated runs (see main/chat/automationRunner.ts). The run lives in the main
 * process, so it keeps going if this page unmounts; on mount this asks what is running and picks
 * the progress events back up.
 *
 * `onTranscriptChanged` fires when the run has written to the open conversation, so the page can
 * reload what it shows. It is read through a ref: the progress subscription outlives renders.
 */
export function useAutomation(conversationId: string | null, onTranscriptChanged: () => void): UseAutomation {
  const [active, setActive] = useState<AutomationRunSummary | null>(null);
  const [phase, setPhase] = useState<AutomationPhase>('idle');
  const [runs, setRuns] = useState<AutomationRunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onChangedRef = useRef(onTranscriptChanged);
  onChangedRef.current = onTranscriptChanged;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const refreshRuns = useCallback(async () => {
    setRuns(await window.electronAPI.automation.list());
  }, []);

  useEffect(() => {
    void window.electronAPI.automation.getActive().then((progress) => {
      setActive(progress?.run ?? null);
      setPhase(progress?.phase ?? 'idle');
    });
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.automation.onProgress((progress) => {
      const stillRunning = progress.run.status === 'running';
      setActive(stillRunning ? progress.run : null);
      setPhase(progress.phase);
      if (!stillRunning) void refreshRuns();
      if (progress.transcriptChanged && progress.run.conversationId === conversationIdRef.current) {
        onChangedRef.current();
      }
    });
    return unsubscribe;
  }, [refreshRuns]);

  const start = useCallback(
    async (request: AutomationStartRequest) => {
      setError(null);
      try {
        setActive(await window.electronAPI.automation.start(request));
        void refreshRuns();
      } catch (startError) {
        setError((startError as Error).message);
      }
    },
    [refreshRuns]
  );

  const stop = useCallback(async () => {
    await window.electronAPI.automation.stop();
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return {
    active,
    phase,
    automatingHere: active != null && active.conversationId === conversationId,
    runs,
    error,
    start,
    stop,
    refreshRuns,
    dismissError,
  };
}
