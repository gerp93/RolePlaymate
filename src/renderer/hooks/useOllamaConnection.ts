import { useCallback, useEffect, useState } from 'react';

export type OllamaConnectionState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'unavailable'; message: string };

export function useOllamaConnection() {
  const [state, setState] = useState<OllamaConnectionState>({ status: 'loading' });

  const check = useCallback(async () => {
    const result = await window.electronAPI.ollama.listModelsDetailed();
    if (result.available) {
      setState({ status: 'ready' });
    } else {
      setState({ status: 'unavailable', message: result.message });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (state.status !== 'unavailable') return;
    const interval = window.setInterval(() => {
      void check();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [state.status, check]);

  return { state, check };
}
