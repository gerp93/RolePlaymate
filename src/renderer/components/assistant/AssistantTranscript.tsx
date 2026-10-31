import { useEffect, useRef } from 'react';
import { AssistantMessage, AssistantProposal } from '../../../shared/types/assistant';
import ProposalCard from './ProposalCard';
import { describeToolCall } from './describeToolCall';

interface Props {
  messages: AssistantMessage[];
  proposals: AssistantProposal[];
  /** Text the model is writing right now, not stored yet. */
  liveText: string;
  /** What tools are doing right now ("Reading character Mira"), empty when none are. */
  status: string;
  running: boolean;
  starters: string[];
  onStarter: (text: string) => void;
  onProposalResolved: (proposal: AssistantProposal) => void;
}

export default function AssistantTranscript({
  messages,
  proposals,
  liveText,
  status,
  running,
  starters,
  onStarter,
  onProposalResolved,
}: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, liveText, status, proposals.length]);

  const proposalByMessage = new Map(proposals.filter((p) => p.messageId).map((p) => [p.messageId as string, p]));

  if (messages.length === 0 && !running) {
    return (
      <div className="assistant-transcript assistant-empty">
        <h2>Library assistant</h2>
        <p className="text-muted">
          Brainstorm characters, personas and scenarios, ask what is already in your library, and have changes drafted
          for you to review. Nothing is saved until you click Apply, and applying adds a new version, so the old text
          is never lost. It all runs on your own Ollama.
        </p>
        <div className="assistant-starters">
          {starters.map((text) => (
            <button key={text} type="button" className="btn" onClick={() => onStarter(text)}>
              {text}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="assistant-transcript">
      {messages.map((message) => {
        if (message.role === 'user') {
          return (
            <div key={message.id} className="assistant-bubble assistant-bubble-user">
              {message.content}
            </div>
          );
        }
        if (message.role === 'tool') {
          const proposal = proposalByMessage.get(message.id);
          return (
            <div key={message.id} className="assistant-tool-result">
              <details>
                <summary>Result: {message.toolName}</summary>
                <pre>{message.content}</pre>
              </details>
              {proposal && <ProposalCard proposal={proposal} onResolved={onProposalResolved} />}
            </div>
          );
        }
        return (
          <div key={message.id}>
            {message.content && <div className="assistant-bubble assistant-bubble-assistant">{message.content}</div>}
            {message.toolCalls && (
              <div className="assistant-chips">
                {message.toolCalls.map((call, i) => (
                  <span key={i} className="assistant-chip">
                    {describeToolCall(call)}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {running && liveText && <div className="assistant-bubble assistant-bubble-assistant">{liveText}</div>}
      {running && !liveText && (
        <div className="assistant-working text-muted">{status || 'Thinking...'}</div>
      )}
      <div ref={endRef} />
    </div>
  );
}
