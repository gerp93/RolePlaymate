import { ReactNode, useState } from 'react';
import LimitedTextarea from '../LimitedTextarea';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';

interface Props {
  disabled: boolean;
  isGenerating: boolean;
  onSend: (message: string, directions: string) => void;
  onCancel: () => void;
  /** Undefined when there's nothing to suggest from yet (no character/model picked) -- the
   * control is hidden rather than disabled in that case. */
  onSuggest?: () => Promise<string>;
  /** Controlled from Chat.tsx (rather than owned locally) so a persona swap can prepopulate a
   * stock scene note here without reaching into the composer's internals. */
  directions: string;
  onDirectionsChange: (value: string) => void;
  directionsOpen: boolean;
  onDirectionsOpenChange: (open: boolean) => void;
  /** Model picker rendered on the same row as Send, under the textarea. */
  modelPicker: ReactNode;
  messageCount?: ReactNode;
  /** Queue-mode only: skip the clip that's playing and start the next. Hidden when omitted. */
  onSkipDialogue?: () => void;
  /** True while a clip is generating, playing, or paused -- the skip control is disabled otherwise. */
  skipDialogueReady?: boolean;
}

/**
 * Message input. Temperature/max tokens and the rest of the per-chat toggles live in the
 * right sidebar's Settings tab -- see ChatSettingsPanel.
 *
 * Directions are transient by design: they are injected into this turn's system prompt and
 * then cleared, never stored on the conversation.
 */
export default function Composer({
  disabled,
  isGenerating,
  onSend,
  onCancel,
  onSuggest,
  directions,
  onDirectionsChange,
  directionsOpen,
  onDirectionsOpenChange,
  modelPicker,
  messageCount,
  onSkipDialogue,
  skipDialogueReady,
}: Props) {
  const [message, setMessage] = useState('');

  // Drafts for "what might my persona say next". Use this sends the shown text as the next
  // turn; Edit lets you change it in this card first. The composer box is left alone.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [editingSuggestion, setEditingSuggestion] = useState(false);

  const submit = () => {
    if (!message.trim() || disabled || isGenerating) return;
    onSend(message, directions);
    setMessage('');
    onDirectionsChange('');
    setSuggestions([]);
    setEditingSuggestion(false);
  };

  const requestSuggestion = async () => {
    if (!onSuggest || suggesting || isGenerating) return;
    setSuggesting(true);
    try {
      const suggestion = await onSuggest();
      setSuggestions((current) => {
        const next = [...current, suggestion];
        setSuggestionIndex(next.length - 1);
        return next;
      });
      setEditingSuggestion(false);
    } finally {
      setSuggesting(false);
    }
  };

  const stepSuggestion = (delta: number) => {
    setSuggestionIndex((i) => (i + delta + suggestions.length) % suggestions.length);
  };

  const currentSuggestion = suggestions[suggestionIndex] ?? '';

  const sendSuggestion = () => {
    const text = currentSuggestion.trim();
    if (!text || disabled || isGenerating) return;
    onSend(text, directions);
    onDirectionsChange('');
    setSuggestions([]);
    setEditingSuggestion(false);
  };

  const discardSuggestions = () => {
    setSuggestions([]);
    setEditingSuggestion(false);
  };

  return (
    <div className="chat-composer">
      <div className="chat-composer-controls">
        {onSkipDialogue && (
          <span
            className="chat-skip-dialogue-wrap"
            title={
              skipDialogueReady
                ? 'Skip the currently playing dialogue and go to the next one.'
                : 'Nothing playing.'
            }
          >
            <button
              type="button"
              className="btn chat-skip-dialogue"
              disabled={!skipDialogueReady}
              onClick={onSkipDialogue}
            >
              Skip dialogue
            </button>
          </span>
        )}
        <button
          type="button"
          className={`btn chat-directions-toggle${directionsOpen ? ' active' : ''}`}
          onClick={() => onDirectionsOpenChange(!directionsOpen)}
        >
          🎬 Directions{directions.trim() ? ' •' : ''}
        </button>
      </div>

      {directionsOpen && (
        <LimitedTextarea
          className="chat-directions"
          limit={FIELD_LIMITS.directions}
          compactCount
          fieldClassName="chat-directions-field"
          placeholder="Scene instructions for this turn only — not saved to the conversation."
          value={directions}
          onChange={(e) => onDirectionsChange(e.target.value)}
          rows={2}
        />
      )}

      {suggestions.length > 0 && (
        <div className="chat-suggestion">
          {editingSuggestion ? (
            <LimitedTextarea
              className="chat-suggestion-editor"
              limit={FIELD_LIMITS.chatMessage}
              compactCount
              fieldClassName="chat-suggestion-editor-field"
              value={currentSuggestion}
              autoGrow
              maxRows={12}
              autoFocus
              onChange={(e) => {
                const next = e.target.value;
                setSuggestions((current) => current.map((s, i) => (i === suggestionIndex ? next : s)));
              }}
            />
          ) : (
            <p className="chat-suggestion-text">{currentSuggestion}</p>
          )}
          <div className="chat-suggestion-actions">
            {suggestions.length > 1 && (
              <>
                <button type="button" className="chat-variant-btn" onClick={() => stepSuggestion(-1)} aria-label="Previous suggestion">
                  ‹
                </button>
                <span className="chat-variant-count">
                  {suggestionIndex + 1}/{suggestions.length}
                </span>
                <button type="button" className="chat-variant-btn" onClick={() => stepSuggestion(1)} aria-label="Next suggestion">
                  ›
                </button>
              </>
            )}
            <button type="button" className="btn" disabled={suggesting} onClick={() => void requestSuggestion()}>
              {suggesting ? 'Thinking…' : 'Another…'}
            </button>
            {!editingSuggestion && (
              <button
                type="button"
                className="btn"
                onClick={() => setEditingSuggestion(true)}
                title="Edit this suggestion"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={disabled || isGenerating || !currentSuggestion.trim()}
              onClick={sendSuggestion}
            >
              Use this
            </button>
            <button type="button" className="chat-variant-btn" onClick={discardSuggestions} title="Discard">
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="chat-composer-input-shell">
        <LimitedTextarea
          className="chat-input"
          limit={FIELD_LIMITS.chatMessage}
          compactCount
          fieldClassName="chat-composer-input"
          placeholder={disabled ? 'Pick a character and model to start.' : 'Write your message…'}
          value={message}
          disabled={disabled}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline -- the convention for chat inputs.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {onSuggest && (
          <button
            type="button"
            className="chat-suggest-in-field"
            disabled={disabled || isGenerating || suggesting}
            onClick={() => void requestSuggestion()}
            title="Draft what your persona might say next"
          >
            {suggesting ? '💡 Thinking…' : '💡 Suggest'}
          </button>
        )}
      </div>

      <div className="chat-settings-row">
        {modelPicker}
        {isGenerating ? (
          <button type="button" className="btn btn-danger chat-send" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary chat-send"
            disabled={disabled || !message.trim()}
            onClick={submit}
          >
            Send
          </button>
        )}
        {messageCount}
      </div>
    </div>
  );
}
