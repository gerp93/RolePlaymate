import { useState } from 'react';

interface Props {
  disabled: boolean;
  isGenerating: boolean;
  onSend: (message: string, directions: string) => void;
  /** Lets the character take another turn on its own -- no message required, since there isn't
   * one this turn. Still passes along whatever's in the Directions box, same as onSend. */
  onContinue: (directions: string) => void;
  onCancel: () => void;
  /** Undefined when there's nothing to suggest from yet (no character/model picked) -- the
   * button is hidden rather than disabled in that case. */
  onSuggest?: () => Promise<string>;
}

/**
 * Message input, per-turn directions, and the reply-suggestion drafts. Temperature/max tokens
 * live in Chat.tsx's header settings now, not here -- see chat-settings-more.
 *
 * Directions are transient by design: they are injected into this turn's system prompt and
 * then cleared, never stored on the conversation.
 */
export default function Composer({
  disabled,
  isGenerating,
  onSend,
  onContinue,
  onCancel,
  onSuggest,
}: Props) {
  const [message, setMessage] = useState('');
  const [directions, setDirections] = useState('');
  const [directionsOpen, setDirectionsOpen] = useState(false);

  // Drafts for "what might my persona say next" -- purely local to the composer. Nothing
  // here is sent or persisted until Use fills the real message box and Send is pressed like
  // any other turn.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggesting, setSuggesting] = useState(false);

  const submit = () => {
    if (!message.trim() || disabled || isGenerating) return;
    onSend(message, directions);
    setMessage('');
    setDirections('');
    setSuggestions([]);
  };

  const submitContinue = () => {
    if (disabled || isGenerating) return;
    onContinue(directions);
    setDirections('');
    setSuggestions([]);
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
    } finally {
      setSuggesting(false);
    }
  };

  const stepSuggestion = (delta: number) => {
    setSuggestionIndex((i) => (i + delta + suggestions.length) % suggestions.length);
  };

  const useSuggestion = () => {
    const current = suggestions[suggestionIndex];
    if (current === undefined) return;
    setMessage(current);
    setSuggestions([]);
  };

  return (
    <div className="chat-composer">
      <div className="chat-composer-controls">
        <button
          type="button"
          className={`btn chat-directions-toggle${directionsOpen ? ' active' : ''}`}
          onClick={() => setDirectionsOpen((open) => !open)}
        >
          🎬 Directions{directions.trim() ? ' •' : ''}
        </button>

        {onSuggest && (
          <button
            type="button"
            className="btn"
            disabled={disabled || isGenerating || suggesting}
            onClick={() => void requestSuggestion()}
            title="Draft what your persona might say next"
          >
            {suggesting ? '💡 Thinking…' : '💡 Suggest'}
          </button>
        )}
      </div>

      {directionsOpen && (
        <textarea
          className="chat-directions"
          placeholder="Scene instructions for this turn only — not saved to the conversation."
          value={directions}
          onChange={(e) => setDirections(e.target.value)}
          rows={2}
        />
      )}

      {suggestions.length > 0 && (
        <div className="chat-suggestion">
          <p className="chat-suggestion-text">{suggestions[suggestionIndex]}</p>
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
            <button type="button" className="btn btn-primary" onClick={useSuggestion}>
              Use this
            </button>
            <button type="button" className="chat-variant-btn" onClick={() => setSuggestions([])} title="Discard">
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="chat-composer-row">
        <textarea
          className="chat-input"
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
        {isGenerating ? (
          <button type="button" className="btn btn-danger chat-send" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <div className="chat-composer-actions">
            <button
              type="button"
              className="btn btn-primary chat-send"
              disabled={disabled || !message.trim()}
              onClick={submit}
            >
              Send
            </button>
            <button
              type="button"
              className="btn chat-send"
              disabled={disabled}
              onClick={submitContinue}
              title="Have the character take another turn on its own, without a reply from you"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
