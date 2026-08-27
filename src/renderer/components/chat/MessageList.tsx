import { ReactNode, useEffect, useRef } from 'react';
import { Message, MessageVariant } from '../../../shared/types/message';
import FormattedContent from '../FormattedContent';

interface Props {
  messages: Message[];
  streamingText: string;
  isGenerating: boolean;
  isRegenerating: boolean;
  variants: MessageVariant[];
  onRegenerate: () => void;
  onSelectVariant: (variantId: string) => void;
  onDeleteLast: () => void;
  onViewPrompt: (messageId: string) => void;
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
export default function MessageList({
  messages,
  streamingText,
  isGenerating,
  isRegenerating,
  variants,
  onRegenerate,
  onSelectVariant,
  onDeleteLast,
  onViewPrompt,
  characterName,
  personaName,
}: Props) {
  const bottom = useRef<HTMLDivElement>(null);

  // Follow the stream as it grows, and jump to the end when a conversation is opened.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, streamingText, isGenerating]);

  if (messages.length === 0 && !streamingText) {
    return (
      <div className="chat-transcript chat-transcript-empty">
        <p className="text-muted">No messages yet. Say something to get started.</p>
      </div>
    );
  }

  // A redo replaces the last bubble in place rather than appending underneath it -- the old
  // content is hidden for the moment the streaming text (or typing indicator) stands in for it.
  const shown = isRegenerating ? messages.slice(0, -1) : messages;
  const lastIndex = shown.length - 1;
  // Redo and delete only ever target the very last message -- an assistant turn with a user
  // reply after it is already finalized, so its variants (if any, left over from a redo) are
  // no longer swipeable, and deleting it would leave a hole rather than popping the stack.
  const canActOnLast = !isGenerating && lastIndex >= 0;
  // The character's opening greeting is seeded from the character profile when the
  // conversation is created, not generated -- it's the only assistant message that can ever
  // be first with no preceding user turn. There is nothing to redo it *from*, so it never
  // gets a variant of its own (the backend rejects a redo attempt on it for the same reason);
  // this just keeps the control from being offered in the first place.
  const isGreeting = lastIndex === 0 && shown[0]?.role === 'assistant';

  return (
    <div className="chat-transcript">
      {shown.map((message, i) => (
        <Bubble
          key={message.id}
          role={message.role}
          name={message.role === 'user' ? personaName : characterName}
          content={message.content}
          model={message.role === 'assistant' ? message.model : null}
          onViewPrompt={message.model ? () => onViewPrompt(message.id) : undefined}
        >
          {canActOnLast && i === lastIndex && (
            <div className="chat-message-footer">
              {message.role === 'assistant' && !isGreeting && (
                <VariantNav
                  variants={variants}
                  selectedId={message.selectedVariantId}
                  onSelect={onSelectVariant}
                  onRegenerate={onRegenerate}
                />
              )}
              <button
                type="button"
                className="chat-variant-btn chat-message-delete"
                onClick={onDeleteLast}
                title="Delete this message"
              >
                🗑
              </button>
            </div>
          )}
        </Bubble>
      ))}
      {streamingText ? (
        <Bubble role="assistant" name={characterName} content={streamingText} streaming />
      ) : (
        isGenerating && <TypingIndicator name={characterName} />
      )}
      <div ref={bottom} />
    </div>
  );
}

/** Shown between sending a message and the first token arriving, so a slow model start (lore
 * scanning, memory retrieval, the request round-trip) doesn't read as the app having hung --
 * the blinking caret on the streaming bubble covers the same worry once tokens are flowing. */
function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="chat-bubble chat-bubble-assistant chat-bubble-typing">
      <div className="chat-bubble-name">{name}</div>
      <div className="chat-typing-dots" aria-label={`${name} is typing`}>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/**
 * Redo controls for the last assistant message: step between existing variants, and generate
 * another one. Nothing here touches the database directly -- picking a variant or regenerating
 * only changes which reply is *shown*. It isn't folded into the model's context or mined for
 * memories until the next message is sent, whichever one is showing at that point.
 */
function VariantNav({
  variants,
  selectedId,
  onSelect,
  onRegenerate,
}: {
  variants: MessageVariant[];
  selectedId: string | null;
  onSelect: (variantId: string) => void;
  onRegenerate: () => void;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.id === selectedId)
  );

  const step = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    if (next) onSelect(next.id);
  };

  return (
    <div className="chat-variant-nav">
      {variants.length > 1 && (
        <>
          <button type="button" className="chat-variant-btn" onClick={() => step(-1)} aria-label="Previous response">
            ‹
          </button>
          <span className="chat-variant-count">
            {index + 1}/{variants.length}
          </span>
          <button type="button" className="chat-variant-btn" onClick={() => step(1)} aria-label="Next response">
            ›
          </button>
        </>
      )}
      <button type="button" className="chat-variant-btn chat-variant-redo" onClick={onRegenerate} title="Redo response">
        ↻ Redo
      </button>
    </div>
  );
}

function Bubble({
  role,
  name,
  content,
  streaming = false,
  model,
  onViewPrompt,
  children,
}: {
  role: string;
  name: string;
  content: string;
  streaming?: boolean;
  /** Shown in a hover tooltip below the bubble. Undefined/null for user messages and for an
   * assistant message that predates this column -- nothing to report either way. */
  model?: string | null;
  /** Present only when there's logged prompt data to show -- see `model`. */
  onViewPrompt?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`chat-bubble chat-bubble-${role}${streaming ? ' chat-bubble-streaming' : ''}`}>
      <div className="chat-bubble-name">{name}</div>
      <div className="chat-bubble-body">
        <FormattedContent text={content} />
        {streaming && <span className="chat-caret" aria-hidden="true" />}
      </div>
      {children}
      {model && (
        <div className="chat-bubble-hover-info">
          <span>Model: {model}</span>
          {onViewPrompt && (
            <button type="button" className="chat-bubble-hover-link" onClick={onViewPrompt}>
              View prompt
            </button>
          )}
        </div>
      )}
    </div>
  );
}
