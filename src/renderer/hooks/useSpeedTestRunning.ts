import { useCallback, useEffect, useState } from 'react';
import { BenchmarkProgress } from '../../shared/types/automation';

/**
 * Whether a speed test (Model Tuning -> Speed test) is running right now, and how far along it is.
 * While it is, the main process refuses chat replies and speech so nothing else competes for the
 * GPU; this lets the chat page say so up front instead of failing a turn. Mirrors the test's
 * progress events, so it follows the test from start to finish even if the Model Tuning page is
 * closed.
 */
export function useSpeedTestRunning(): {
  running: boolean;
  progress: BenchmarkProgress | null;
  stop: () => Promise<void>;
} {
  const [progress, setProgress] = useState<BenchmarkProgress | null>(null);

  useEffect(() => {
    void window.electronAPI.benchmark.getActive().then(setProgress);
    const unsubscribe = window.electronAPI.benchmark.onProgress((next) => {
      setProgress(next.benchmark.status === 'running' ? next : null);
    });
    return unsubscribe;
  }, []);

  const stop = useCallback(async () => {
    await window.electronAPI.benchmark.stop();
  }, []);

  return { running: progress !== null, progress, stop };
}
