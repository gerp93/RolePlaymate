import { useEffect, useState } from 'react';
import {
  AssistantConversation,
  AssistantSettings,
  MAX_NOTES_CHARS,
  MAX_STYLE_GUIDE_CHARS,
} from '../../../shared/types/assistant';
import { OllamaModelInfo } from '../../../shared/types/ollama';
import LimitedTextarea from '../LimitedTextarea';

interface Props {
  settings: AssistantSettings;
  models: OllamaModelInfo[];
  conversation: AssistantConversation | null;
  disabled: boolean;
  onModel: (model: string) => void;
  onContextWindow: (tokens: number) => void;
  onStyleGuide: (text: string) => void;
  onNotes: (text: string) => void;
}

const WINDOWS = [4096, 8192, 16384, 32768, 65536, 131072];

/** The knobs that shape what the assistant knows: which model, how much it can hold, the user's own
 * style guide (the form they want cards in) and this conversation's working notes. */
export default function AssistantContextPanel({
  settings,
  models,
  conversation,
  disabled,
  onModel,
  onContextWindow,
  onStyleGuide,
  onNotes,
}: Props) {
  const [styleGuide, setStyleGuide] = useState(settings.styleGuide);
  const [notes, setNotes] = useState(conversation?.notes ?? '');
  useEffect(() => setStyleGuide(settings.styleGuide), [settings.styleGuide]);
  useEffect(() => setNotes(conversation?.notes ?? ''), [conversation?.id, conversation?.notes]);

  const model = conversation?.model || settings.model;
  const known = models.some((m) => m.name === model);
  const current = models.find((m) => m.name === model);
  const lacksTools = !!current && current.capabilities.length > 0 && !current.capabilities.includes('tools');

  return (
    <aside className="assistant-context">
      <div className="field">
        <label htmlFor="assistant-model">Model</label>
        <select id="assistant-model" value={model} disabled={disabled} onChange={(e) => onModel(e.target.value)}>
          {!model && <option value="">Choose a model...</option>}
          {model && !known && <option value={model}>{model} (not installed)</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.parameterSize ? ` (${m.parameterSize})` : ''}
              {m.capabilities.includes('tools') ? ' - tools' : ''}
            </option>
          ))}
        </select>
        {lacksTools && (
          <p className="field-error">
            Ollama does not list tool support for this model, so it cannot look things up or draft changes. Pick one
            marked "tools".
          </p>
        )}
        <p className="text-muted assistant-hint">
          Use a general instruction-following model here, not a roleplay tune: roleplay models are usually poor at
          calling tools.
        </p>
      </div>

      <div className="field">
        <label htmlFor="assistant-window">Context window</label>
        <select
          id="assistant-window"
          value={settings.contextWindow}
          disabled={disabled}
          onChange={(e) => onContextWindow(Number(e.target.value))}
        >
          {WINDOWS.concat(WINDOWS.includes(settings.contextWindow) ? [] : [settings.contextWindow])
            .sort((a, b) => a - b)
            .map((w) => (
              <option key={w} value={w}>
                {w.toLocaleString()} tokens
              </option>
            ))}
        </select>
        <p className="text-muted assistant-hint">
          Separate from roleplay chat's. Bigger holds more conversation and card text but uses more GPU memory; if the
          model slows down a lot, lower it. Older turns are left out of a request when they do not fit.
        </p>
      </div>

      <div className="field">
        <label htmlFor="assistant-notes">Working notes (this conversation)</label>
        <LimitedTextarea
          id="assistant-notes"
          limit={MAX_NOTES_CHARS}
          rows={5}
          value={notes}
          disabled={!conversation}
          placeholder="Decisions and direction. The assistant sees these every turn and can update them."
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (conversation?.notes ?? '') && onNotes(notes)}
        />
      </div>

      <div className="field">
        <label htmlFor="assistant-style">Your style guide</label>
        <LimitedTextarea
          id="assistant-style"
          limit={MAX_STYLE_GUIDE_CHARS}
          rows={7}
          value={styleGuide}
          placeholder="How you like cards written: voice, structure, length, formatting, things to avoid."
          onChange={(e) => setStyleGuide(e.target.value)}
          onBlur={() => styleGuide !== settings.styleGuide && onStyleGuide(styleGuide)}
        />
        <p className="text-muted assistant-hint">
          Applies to every conversation. The assistant also reads your existing cards to match their form, so you can
          just say "write it like Mira's card".
        </p>
      </div>
    </aside>
  );
}
