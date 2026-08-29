import { useEffect, useState } from 'react';
import AboutStepper from '../AboutStepper';
import { OLLAMA_SETUP_TRACK } from '../../guides/ollamaSetupTrack';
import '../../pages/About.css';
import './Chat.css';

interface Props {
  detail?: string;
}

export default function ChatOllamaSetup({ detail }: Props) {
  const [configuredHost, setConfiguredHost] = useState('');

  useEffect(() => {
    void window.electronAPI.ollamaHost.get().then((result) => setConfiguredHost(result.host));
  }, []);

  return (
    <div className="chat-page chat-setup-page">
      <div className="chat-setup-shell">
        <header className="chat-setup-intro card">
          <h1 className="chat-setup-title">Chat isn&apos;t set up yet</h1>
          <p className="chat-setup-lead">
            RolePlaymate needs a local Ollama server before you can start a conversation.
          </p>
          {configuredHost && (
            <p className="chat-setup-status text-muted">
              Waiting for <code>{configuredHost}</code>
              {detail ? <> — {detail}</> : null}.
            </p>
          )}
        </header>

        <AboutStepper track={OLLAMA_SETUP_TRACK} variant="standalone" showFinishButton={false} showChatPageLink={false} />
      </div>
    </div>
  );
}
