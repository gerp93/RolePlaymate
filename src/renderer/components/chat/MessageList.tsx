import { ReactNode, useEffect, useRef, useState } from 'react';
import { Message, MessageVariant } from '../../../shared/types/message';
import { CharacterImage } from '../../../shared/types/characterImage';
import { PersonaImage } from '../../../shared/types/personaImage';
import { resolveCoverImage } from '../../utils/avatarImage';
import { toImageUrl } from '../../utils/imageUrl';
import FormattedContent from '../FormattedContent';
import ImageLightbox from '../ImageLightbox';

interface Props {
  messages: Message[];
  streamingText: string;
  isGenerating: boolean;
  isRegenerating: boolean;
  variants: MessageVariant[];
  onRegenerate: () => void;
  onSelectVariant: (variantId: string) => void;
  /** Hand-edits the last (assistant) message's content -- see chatSession.editMessage. */
  onEditLast: (content: string) => void;
  onDeleteLast: () => void;
  onViewPrompt: (messageId: string) => void;
  characterName: string;
  personaName: string;
  characterImages: CharacterImage[];
  personaImages: PersonaImage[];
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
  onEditLast,
  onDeleteLast,
  onViewPrompt,
  characterName,
  personaName,
  characterImages,
  personaImages,
}: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  // Which message (if any) is showing an edit textarea in place of its formatted content, and
  // what's currently typed into it. Only ever the last message -- see canActOnLast/isGreeting
  // below, which also gate whether the Edit button itself is offered.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // The bubble's own rendered width just before switching into edit mode, frozen as an inline
  // style for the duration of the edit. Bubbles shrink-wrap to their content by default (see
  // .chat-bubble-assistant's align-self: flex-start), so without this a short reply's bubble
  // would collapse down to whatever a bare, still-empty-ish textarea measures as, then jump
  // back out as text is typed -- captured once on click instead of tracked continuously.
  const [editWidth, setEditWidth] = useState<number | null>(null);
  const lastBubbleRef = useRef<HTMLDivElement | null>(null);

  // A message bubble's avatar is always the gallery's cover image -- no per-message variation
  // (that's what the large margin portraits' carousel is for). Cheap to compute once per role.
  const characterAvatarUrl = (() => {
    const image = resolveCoverImage(characterImages);
    return image ? toImageUrl(image.path) : null;
  })();
  const personaAvatarUrl = (() => {
    const image = resolveCoverImage(personaImages);
    return image ? toImageUrl(image.path) : null;
  })();
  const avatarFor = (role: string) => (role === 'user' ? personaAvatarUrl : characterAvatarUrl);

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
          containerRef={i === lastIndex ? lastBubbleRef : undefined}
          containerStyle={
            canActOnLast && i === lastIndex && editingId === message.id && editWidth
              ? { width: editWidth, maxWidth: editWidth }
              : undefined
          }
          role={message.role}
          name={message.role === 'user' ? personaName : characterName}
          avatarUrl={avatarFor(message.role)}
          content={message.content}
          model={message.role === 'assistant' ? message.model : null}
          onViewPrompt={message.model ? () => onViewPrompt(message.id) : undefined}
          isEditing={canActOnLast && i === lastIndex && editingId === message.id}
          editDraft={editDraft}
          onEditDraftChange={setEditDraft}
          onSaveEdit={() => {
            onEditLast(editDraft);
            setEditingId(null);
            setEditWidth(null);
          }}
          onCancelEdit={() => {
            setEditingId(null);
            setEditWidth(null);
          }}
        >
          {canActOnLast && i === lastIndex && editingId !== message.id && (
            <div className="chat-message-footer">
              {message.role === 'assistant' && !isGreeting && (
                <VariantNav
                  variants={variants}
                  selectedId={message.selectedVariantId}
                  onSelect={onSelectVariant}
                  onRegenerate={onRegenerate}
                />
              )}
              {message.role === 'assistant' && !isGreeting && (
                <button
                  type="button"
                  className="chat-variant-btn chat-message-edit"
                  onClick={() => {
                    setEditWidth(lastBubbleRef.current?.getBoundingClientRect().width ?? null);
                    setEditDraft(message.content);
                    setEditingId(message.id);
                  }}
                  title="Edit this response"
                >
                  ✏️ Edit
                </button>
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
        <Bubble role="assistant" name={characterName} avatarUrl={characterAvatarUrl} content={streamingText} streaming />
      ) : (
        isGenerating && <TypingIndicator name={characterName} avatarUrl={characterAvatarUrl} />
      )}
      <div ref={bottom} />
    </div>
  );
}

/** Shown between sending a message and the first token arriving, so a slow model start (lore
 * scanning, memory retrieval, the request round-trip) doesn't read as the app having hung --
 * the blinking caret on the streaming bubble covers the same worry once tokens are flowing. */
function TypingIndicator({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return (
    <div className="chat-bubble chat-bubble-assistant chat-bubble-typing">
      <BubbleAvatarPanel url={avatarUrl} name={name} />
      <div className="chat-bubble-content">
        <div className="chat-bubble-name">{name}</div>
        <div className="chat-typing-dots" aria-label={`${name} is typing`}>
          <span />
          <span />
          <span />
        </div>
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
  avatarUrl,
  content,
  streaming = false,
  model,
  onViewPrompt,
  isEditing = false,
  editDraft = '',
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  containerRef,
  containerStyle,
  children,
}: {
  role: string;
  name: string;
  avatarUrl: string | null;
  content: string;
  streaming?: boolean;
  /** Shown in a hover tooltip below the bubble. Undefined/null for user messages and for an
   * assistant message that predates this column -- nothing to report either way. */
  model?: string | null;
  /** Present only when there's logged prompt data to show -- see `model`. */
  onViewPrompt?: () => void;
  /** Swaps the formatted content for an editable textarea -- see MessageList's editingId. Only
   * ever true for the last message, and only while its Edit button is active. */
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (value: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  /** Only ever attached to the last message, so MessageList can measure its rendered width
   * before switching into edit mode -- see MessageList's editWidth. */
  containerRef?: React.Ref<HTMLDivElement>;
  /** Freezes the bubble at its pre-edit width -- see editWidth. */
  containerStyle?: React.CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      ref={containerRef}
      className={`chat-bubble chat-bubble-${role}${streaming ? ' chat-bubble-streaming' : ''}`}
      style={containerStyle}
    >
      <BubbleAvatarPanel url={avatarUrl} name={name} />
      <div className="chat-bubble-content">
        <div className="chat-bubble-name">{name}</div>
        {isEditing ? (
          <div className="chat-bubble-edit">
            <textarea
              className="chat-bubble-edit-textarea"
              value={editDraft}
              onChange={(e) => onEditDraftChange?.(e.target.value)}
              autoFocus
            />
            <div className="chat-bubble-edit-actions">
              <button type="button" className="btn btn-primary" disabled={!editDraft.trim()} onClick={onSaveEdit}>
                Save
              </button>
              <button type="button" className="btn" onClick={onCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="chat-bubble-body">
            <FormattedContent text={content} />
            {streaming && <span className="chat-caret" aria-hidden="true" />}
          </div>
        )}
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
    </div>
  );
}

/** The avatar fused into the bubble as a full-height image panel, not a separate circle beside
 * it -- an image when the gallery has one, otherwise a colored panel with the name's first
 * letter (same idea as Slack/Discord's default initials). Clicking a real image opens the
 * full-size lightbox. */
function BubbleAvatarPanel({ url, name }: { url: string | null; name: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!url) {
    return (
      <span className="chat-bubble-avatar-panel-fallback" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    );
  }
  return (
    <>
      <img className="chat-bubble-avatar-panel" src={url} alt={name} onClick={() => setExpanded(true)} />
      {expanded && <ImageLightbox url={url} onClose={() => setExpanded(false)} />}
    </>
  );
}
