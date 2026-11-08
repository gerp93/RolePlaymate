import { ReactNode, useEffect, useState } from 'react';
import LimitedTextarea from '../LimitedTextarea';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';
import { formatResponseTime } from '../../utils/formatResponseTime';

/** A drafted persona line; `starred` marks a keeper while paging through the others. */
interface Suggestion {
  text: string;
  starred: boolean;
}

interface Props {
  disabled: boolean;
  isGenerating: boolean;
  onSend: (message: string, directions: string) => void;
  onCancel: () => void;
  /** Undefined when there's nothing to suggest from yet (no character/model picked) -- the
   * control is hidden rather than disabled in that case. */
  onSuggest?: () => Promise<string>;
  /** Opens the "Generate image" dialog. Hidden when omitted (no conversation yet). */
  onGenerateImage?: () => void;
  /** Controlled from Chat.tsx (rather than owned locally) so a persona swap can prepopulate a
   * stock scene note here without reaching into the composer's internals. */
  directions: string;
  onDirectionsChange: (value: string) => void;
  directionsOpen: boolean;
  onDirectionsOpenChange: (open: boolean) => void;
  /** The next speaker's persistent mood. Unlike directions it is saved on the conversation and kept from
   * message to message until changed. Hidden when omitted (no conversation yet). */
  mood?: {
    speakerName: string;
    value: string;
    onSave: (value: string) => void;
  };
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
 * then cleared, never stored on the conversation. Mood is their persistent sibling: saved on the
 * conversation (per speaker) and sent with every reply until the user changes it.
 */
export default function Composer({
  disabled,
  isGenerating,
  onSend,
  onCancel,
  onSuggest,
  onGenerateImage,
  directions,
  onDirectionsChange,
  directionsOpen,
  onDirectionsOpenChange,
  mood,
  modelPicker,
  messageCount,
  onSkipDialogue,
  skipDialogueReady,
}: Props) {
  const [message, setMessage] = useState('');

  // Mood is edited locally and saved when the field loses focus, so typing is not a save per keystroke.
  // Reset whenever the saved value changes -- including when the next speaker changes in a group.
  const [moodOpen, setMoodOpen] = useState(false);
  const savedMood = mood?.value ?? '';
  const [moodDraft, setMoodDraft] = useState(savedMood);
  useEffect(() => setMoodDraft(savedMood), [savedMood, mood?.speakerName]);

  // Drafts for "what might my persona say next". Use this sends the shown text as the next
  // turn; Edit lets you change it in this card first. The composer box is left alone.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [editingSuggestion, setEditingSuggestion] = useState(false);

  // Live "how long has this been waiting" readout on the Stop button -- ticks while
  // isGenerating covers both the pre-first-token wait and the rest of the stream, so it
  // reflects the same span the eventual generation_ms will record. Resets to 0 the moment
  // generation starts or ends, rather than freezing on the last value.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isGenerating) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedMs(0);
    const interval = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
    return () => clearInterval(interval);
  }, [isGenerating]);

  // Directions alone are enough to send -- the character acts on them with no line from the user.
  const canSubmit = Boolean(message.trim() || directions.trim());

  const submit = () => {
    if (!canSubmit || disabled || isGenerating) return;
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
        const next = [...current, { text: suggestion, starred: false }];
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

  const currentSuggestion = suggestions[suggestionIndex]?.text ?? '';
  const starredSuggestions = suggestions.flatMap((s, i) => (s.starred ? [i] : []));

  const toggleSuggestionStar = () => {
    setSuggestions((current) => current.map((s, i) => (i === suggestionIndex ? { ...s, starred: !s.starred } : s)));
  };

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
        {mood && (
          <button
            type="button"
            className={`btn chat-mood-toggle${moodOpen ? ' active' : ''}`}
            title={`${mood.speakerName}'s mood: kept and sent with every reply until you change it`}
            onClick={() => setMoodOpen(!moodOpen)}
          >
            🎭 Mood{savedMood.trim() ? ' •' : ''}
          </button>
        )}
      </div>

      {mood && moodOpen && (
        <LimitedTextarea
          className="chat-directions chat-mood"
          limit={FIELD_LIMITS.mood}
          compactCount
          fieldClassName="chat-directions-field"
          placeholder={`How ${mood.speakerName} feels right now — kept for every reply until you change it. e.g. guarded and a little hurt, trying not to show it.`}
          aria-label={`${mood.speakerName}'s mood`}
          value={moodDraft}
          disabled={disabled}
          onChange={(e) => setMoodDraft(e.target.value)}
          onBlur={() => {
            if (moodDraft.trim() !== savedMood.trim()) mood.onSave(moodDraft);
          }}
          rows={2}
        />
      )}

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
                setSuggestions((current) => current.map((s, i) => (i === suggestionIndex ? { ...s, text: next } : s)));
              }}
            />
          ) : (
            <p className="chat-suggestion-text">{currentSuggestion}</p>
          )}
          <div className="chat-suggestion-actions">
            <button
              type="button"
              className={`chat-variant-btn chat-variant-star-btn${suggestions[suggestionIndex]?.starred ? ' chat-variant-star-btn-active' : ''}`}
              onClick={toggleSuggestionStar}
              title={suggestions[suggestionIndex]?.starred ? 'Unstar this suggestion' : 'Star this suggestion'}
              aria-label={suggestions[suggestionIndex]?.starred ? 'Unstar this suggestion' : 'Star this suggestion'}
              aria-pressed={Boolean(suggestions[suggestionIndex]?.starred)}
            >
              {suggestions[suggestionIndex]?.starred ? '★' : '☆'}
            </button>
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
            {starredSuggestions.length > 0 && (
              <div className="chat-variant-star-chips">
                {starredSuggestions.map((i) => (
                  <button
                    key={i}
                    type="button"
                    className={`chat-variant-star-chip${i === suggestionIndex ? ' chat-variant-star-chip-active' : ''}`}
                    onClick={() => {
                      setSuggestionIndex(i);
                      setEditingSuggestion(false);
                    }}
                    title="Jump to this starred suggestion"
                  >
                    ★ {i + 1}
                  </button>
                ))}
              </div>
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
        {onGenerateImage && (
          <button
            type="button"
            className="chat-suggest-in-field chat-image-in-field"
            disabled={disabled || isGenerating}
            onClick={onGenerateImage}
            title="Draw the current scene with KVGenius"
          >
            🖼 Image
          </button>
        )}
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
            Stop <span className="chat-send-elapsed">{formatResponseTime(elapsedMs)}</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary chat-send"
            disabled={disabled || !canSubmit}
            onClick={submit}
            title={
              message.trim() || !directions.trim()
                ? undefined
                : 'No message -- the character will act on your directions on their own'
            }
          >
            {message.trim() || !directions.trim() ? 'Send' : 'Send directions'}
          </button>
        )}
        {messageCount}
      </div>
    </div>
  );
}
