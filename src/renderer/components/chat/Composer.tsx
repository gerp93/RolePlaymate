import { useState } from 'react';
import { SamplerParams } from '../../../shared/types/chat';

interface Props {
  disabled: boolean;
  isGenerating: boolean;
  samplers: Pick<SamplerParams, 'temperature' | 'maxTokens'>;
  onSamplersChange: (next: Pick<SamplerParams, 'temperature' | 'maxTokens'>) => void;
  onSend: (message: string, directions: string) => void;
  onCancel: () => void;
  /** Undefined when there's nothing to suggest from yet (no character/model picked) -- the
   * button is hidden rather than disabled in that case. */
  onSuggest?: () => Promise<string>;
}

/**
 * Input, per-turn directions, and the two sampler controls the source exposed in chat
 * (temperature and max tokens; the rest come from settings).
 *
 * Directions are transient by design: they are injected into this turn's system prompt and
 * then cleared, never stored on the conversation.
 */
export default function Composer({
  disabled,
  isGenerating,
  samplers,
  onSamplersChange,
  onSend,
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

        <label className="chat-slider">
          Temperature <output>{samplers.temperature.toFixed(2)}</output>
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.1}
            value={samplers.temperature}
            onChange={(e) => onSamplersChange({ ...samplers, temperature: Number(e.target.value) })}
          />
        </label>

        <label className="chat-slider">
          Max tokens <output>{samplers.maxTokens}</output>
          <input
            type="range"
            min={64}
            max={512}
            step={64}
            value={samplers.maxTokens}
            onChange={(e) => onSamplersChange({ ...samplers, maxTokens: Number(e.target.value) })}
          />
        </label>
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
          <button
            type="button"
            className="btn btn-primary chat-send"
            disabled={disabled || !message.trim()}
            onClick={submit}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
