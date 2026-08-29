import { ReactNode } from 'react';
import { useOllamaConnection } from '../../hooks/useOllamaConnection';
import ChatOllamaSetup from './ChatOllamaSetup';
import OllamaSetupLoading from './OllamaSetupLoading';

interface Props {
  children: ReactNode;
}

/** Renders the shared Ollama setup flow until the configured server is reachable. */
export default function OllamaRequiredGate({ children }: Props) {
  const { state } = useOllamaConnection();

  if (state.status === 'loading') {
    return <OllamaSetupLoading />;
  }

  if (state.status === 'unavailable') {
    return <ChatOllamaSetup detail={state.message} />;
  }

  return <>{children}</>;
}
