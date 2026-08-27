import { useEffect, useRef } from 'react';
import { Message } from '../../../shared/types/message';
import FormattedContent from '../FormattedContent';

interface Props {
  messages: Message[];
  streamingText: string;
  characterName: string;
  personaName: string;
}

/**
 * The transcript. Assistant turns render through the app's existing FormattedContent, which
 * already handles *italics*, **bold** and {{macro}} spans -- that supersedes the source's
 * own action/dialogue span builder.
 *
 * Note the formatting is display-only: the unmodified text is what goes to the model.
 */
export default function MessageList({ messages, streamingText, characterName, personaName }: Props) {
  const bottom = useRef<HTMLDivElement>(null);

  // Follow the stream as it grows, and jump to the end when a conversation is opened.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, streamingText]);

  if (messages.length === 0 && !streamingText) {
    return (
      <div className="chat-transcript chat-transcript-empty">
        <p className="text-muted">No messages yet. Say something to get started.</p>
      </div>
    );
  }

  return (
    <div className="chat-transcript">
      {messages.map((message) => (
        <Bubble
          key={message.id}
          role={message.role}
          name={message.role === 'user' ? personaName : characterName}
          content={message.content}
        />
      ))}
      {streamingText && (
        <Bubble role="assistant" name={characterName} content={streamingText} streaming />
      )}
      <div ref={bottom} />
    </div>
  );
}

function Bubble({
  role,
  name,
  content,
  streaming = false,
}: {
  role: string;
  name: string;
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className={`chat-bubble chat-bubble-${role}${streaming ? ' chat-bubble-streaming' : ''}`}>
      <div className="chat-bubble-name">{name}</div>
      <div className="chat-bubble-body">
        <FormattedContent text={content} />
        {streaming && <span className="chat-caret" aria-hidden="true" />}
      </div>
    </div>
  );
}
