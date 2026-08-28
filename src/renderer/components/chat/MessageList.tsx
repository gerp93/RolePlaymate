import { MouseEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Message, MessageVariant } from '../../../shared/types/message';
import { CharacterImage } from '../../../shared/types/characterImage';
import { PersonaImage } from '../../../shared/types/personaImage';
import { resolveCoverImage } from '../../utils/avatarImage';
import { toImageUrl } from '../../utils/imageUrl';
import FormattedContent from '../FormattedContent';
import ImageLightbox from '../ImageLightbox';
import LimitedTextarea from '../LimitedTextarea';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';

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
  /** Rewrites the user message behind the pending reply and regenerates that reply against the
   * new text -- see chatSession.editPriorUserMessage. Only offered on the one message right
   * before the pending assistant reply. */
  onEditPrior: (messageId: string, content: string) => void;
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
  onEditPrior,
  onDeleteLast,
  onViewPrompt,
  characterName,
  personaName,
  characterImages,
  personaImages,
}: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  // Which message (if any) is showing an edit textarea in place of its formatted content, and
  // what's currently typed into it. Either the last message (assistant, see canActOnLast/
  // isGreeting below) or the one right before it (the user turn behind a pending reply, see
  // canEditPriorUser) -- never both at once, and never anything earlier.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // The bubble's own rendered width just before switching into edit mode, frozen as an inline
  // style for the duration of the edit. Bubbles shrink-wrap to their content by default (see
  // .chat-bubble-assistant's align-self: flex-start), so without this a short reply's bubble
  // would collapse down to whatever a bare, still-empty-ish textarea measures as, then jump
  // back out as text is typed -- measured off the clicked button's own bubble ancestor at click
  // time rather than a persistent ref, since which bubble can start an edit now varies.
  const [editWidth, setEditWidth] = useState<number | null>(null);

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
  // The one message besides the last that can still be edited: the user turn the pending reply
  // is answering. Anything earlier already has a reply after it -- see
  // chatSession.editPriorUserMessage for why that boundary exists.
  const canEditPriorUser =
    canActOnLast && lastIndex >= 1 && shown[lastIndex]?.role === 'assistant' && shown[lastIndex - 1]?.role === 'user';

  const startEdit = (e: MouseEvent<HTMLButtonElement>, message: Message) => {
    const bubble = e.currentTarget.closest('.chat-bubble') as HTMLElement | null;
    setEditWidth(bubble?.getBoundingClientRect().width ?? null);
    setEditDraft(message.content);
    setEditingId(message.id);
  };

  return (
    <div className="chat-transcript">
      {shown.map((message, i) => {
        const isEditableSlot = (canActOnLast && i === lastIndex) || (canEditPriorUser && i === lastIndex - 1);
        const isEditing = isEditableSlot && editingId === message.id;
        return (
          <Bubble
            key={message.id}
            containerStyle={isEditing && editWidth ? { width: editWidth, maxWidth: editWidth } : undefined}
            role={message.role}
            name={message.role === 'user' ? personaName : characterName}
            avatarUrl={avatarFor(message.role)}
            content={message.content}
            model={message.role === 'assistant' ? message.model : null}
            onViewPrompt={message.model ? () => onViewPrompt(message.id) : undefined}
            isEditing={isEditing}
            editDraft={editDraft}
            onEditDraftChange={setEditDraft}
            onSaveEdit={() => {
              if (i === lastIndex) onEditLast(editDraft);
              else onEditPrior(message.id, editDraft);
              setEditingId(null);
              setEditWidth(null);
            }}
            onCancelEdit={() => {
              setEditingId(null);
              setEditWidth(null);
            }}
          >
            {isEditableSlot && editingId !== message.id && (
              <div className="chat-message-footer">
                {i === lastIndex && message.role === 'assistant' && !isGreeting && (
                  <VariantNav
                    variants={variants}
                    selectedId={message.selectedVariantId}
                    onSelect={onSelectVariant}
                    onRegenerate={onRegenerate}
                  />
                )}
                {((i === lastIndex && message.role === 'assistant' && !isGreeting) ||
                  (canEditPriorUser && i === lastIndex - 1)) && (
                  <button
                    type="button"
                    className="chat-variant-btn chat-message-edit"
                    onClick={(e) => startEdit(e, message)}
                    title={i === lastIndex ? 'Edit this response' : 'Edit this message and regenerate the reply to it'}
                    aria-label={i === lastIndex ? 'Edit this response' : 'Edit this message and regenerate the reply to it'}
                  >
                    ✏️
                  </button>
                )}
                {i === lastIndex && !isGreeting && (
                  <button
                    type="button"
                    className="chat-variant-btn chat-message-delete"
                    onClick={onDeleteLast}
                    title="Delete this message"
                    aria-label="Delete this message"
                  >
                    🗑️
                  </button>
                )}
              </div>
            )}
          </Bubble>
        );
      })}
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
      <button
        type="button"
        className="chat-variant-btn chat-variant-redo"
        onClick={onRegenerate}
        title="Redo response"
        aria-label="Redo response"
      >
        ↻
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
  /** Swaps the formatted content for an editable textarea -- see MessageList's editingId. */
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (value: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  /** Freezes the bubble at its pre-edit width -- see editWidth. */
  containerStyle?: React.CSSProperties;
  children?: ReactNode;
}) {
  // Plain text, not the rendered FormattedContent HTML -- the transcript's own content is
  // already the "full formatted message" (italics/bold as *asterisks*, same as what's stored
  // and what goes to the model), so copying it verbatim is what pastes usably elsewhere.
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`chat-bubble chat-bubble-${role}${streaming ? ' chat-bubble-streaming' : ''}`} style={containerStyle}>
      <BubbleAvatarPanel url={avatarUrl} name={name} />
      <div className="chat-bubble-content">
        <div className="chat-bubble-name-row">
          <div className="chat-bubble-name">{name}</div>
          {!streaming && (
            <button
              type="button"
              className="chat-bubble-copy"
              onClick={handleCopy}
              title={copied ? 'Copied!' : 'Copy message'}
            >
              {copied ? '✅' : '📋'}
            </button>
          )}
        </div>
        {isEditing ? (
          <div className="chat-bubble-edit">
            <LimitedTextarea
              className="chat-bubble-edit-textarea"
              limit={FIELD_LIMITS.chatMessage}
              compactCount
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
