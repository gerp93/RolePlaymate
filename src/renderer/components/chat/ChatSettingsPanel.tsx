import { ReactNode, useEffect, useState } from 'react';
import { CharacterTtsVoice } from '../../../shared/types/tts';
import { TtsOverlapMode, TtsReadingMode, TtsTrackMode } from '../../../shared/utils/ttsSegments';
import { CHAT_FONT_SIZES, ChatFontSize } from '../../utils/chatFontSize';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';
import LimitedTextarea from '../LimitedTextarea';
import AutomationLock from './AutomationLock';
import StartScreenPicker, { StartPickerOption } from './StartScreenPicker';

interface Samplers {
  temperature: number;
  maxTokens: number;
}

interface Props {
  fontSize: ChatFontSize;
  onFontSizeChange: (size: ChatFontSize) => void;
  conversationId: string | null;
  personaId: string;
  onPersonaChange: (id: string) => void;
  personaPickerOptions: StartPickerOption[];
  showPortraitsToggle: boolean;
  showPortraits: boolean;
  portraitsTooNarrow: boolean;
  onShowPortraitsChange: (value: boolean) => void;
  characterSpeechAvailable: boolean;
  personaSpeechAvailable: boolean;
  characterTrack: TtsTrackMode;
  onCharacterTrackChange: (value: TtsTrackMode) => void;
  readingMode: TtsReadingMode;
  onReadingModeChange: (value: TtsReadingMode) => void;
  personaTrack: TtsTrackMode;
  onPersonaTrackChange: (value: TtsTrackMode) => void;
  personaReadingMode: TtsReadingMode;
  onPersonaReadingModeChange: (value: TtsReadingMode) => void;
  overlapMode: TtsOverlapMode;
  onOverlapModeChange: (value: TtsOverlapMode) => void;
  skipItalics: boolean;
  onSkipItalicsChange: (value: boolean) => void;
  narratorVoice: CharacterTtsVoice | null;
  canSplitCharacter: boolean;
  canSplitPersona: boolean;
  samplers: Samplers;
  defaultSamplers: Samplers;
  onSamplersChange: (next: Samplers) => void;
  keepForever: boolean;
  onKeepForeverChange: (keep: boolean) => void;
  conciseReplies: boolean;
  onConciseRepliesChange: (value: boolean) => void;
  narrationPov: 'first' | 'third' | null;
  onNarrationPovChange: (value: 'first' | 'third' | null) => void;
  /** An automated run is going: the sections that change how the chat behaves are covered. The
   * ones that only change how it looks or sounds stay editable. */
  automationLocked?: boolean;
  /** This chat's scene note and a way to save it (empty clears it). */
  sceneNote: string;
  onSceneNoteSave: (note: string) => void;
  /** Whether replies are checked for a change of scene (an app-wide setting). */
  sceneSuggestions: boolean;
  onSceneSuggestionsChange: (value: boolean) => void;
}

/** Hover/focus card — Electron's native `title` tooltips look dated and often don't show. */
function SettingsInfoTip({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <span className="chat-settings-info-wrap">
      <button
        type="button"
        className="chat-settings-info"
        aria-label={ariaLabel}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        ⓘ
      </button>
      <span className="chat-settings-info-tip" role="tooltip">
        {children}
      </span>
    </span>
  );
}

/**
 * Display, speech, and sampler controls for the current chat. Lives in the right sidebar
 * rather than under the composer -- these don't change every turn, and stacking them
 * full-width keeps every control the same size.
 */
export default function ChatSettingsPanel({
  fontSize,
  onFontSizeChange,
  conversationId,
  personaId,
  onPersonaChange,
  personaPickerOptions,
  showPortraitsToggle,
  showPortraits,
  portraitsTooNarrow,
  onShowPortraitsChange,
  characterSpeechAvailable,
  personaSpeechAvailable,
  characterTrack,
  onCharacterTrackChange,
  readingMode,
  onReadingModeChange,
  personaTrack,
  onPersonaTrackChange,
  personaReadingMode,
  onPersonaReadingModeChange,
  overlapMode,
  onOverlapModeChange,
  skipItalics,
  onSkipItalicsChange,
  narratorVoice,
  canSplitCharacter,
  canSplitPersona,
  samplers,
  defaultSamplers,
  onSamplersChange,
  keepForever,
  onKeepForeverChange,
  conciseReplies,
  onConciseRepliesChange,
  narrationPov,
  onNarrationPovChange,
  automationLocked = false,
  sceneNote,
  onSceneNoteSave,
  sceneSuggestions,
  onSceneSuggestionsChange,
}: Props) {
  // Edited locally and saved when the field loses focus, so typing is not a save per keystroke.
  const [sceneDraft, setSceneDraft] = useState(sceneNote);
  useEffect(() => setSceneDraft(sceneNote), [sceneNote]);

  const speechAvailable = characterSpeechAvailable || personaSpeechAvailable;
  const speechActive =
    (characterSpeechAvailable && characterTrack !== 'off') ||
    (personaSpeechAvailable && personaTrack !== 'off');

  return (
    <div className="chat-settings-panel">
      <AutomationLock
        locked={automationLocked}
        message={
          <>
            <strong>Locked during an automated run</strong>
            <span>The run plays this persona.</span>
          </>
        }
      >
      {conversationId && (
        <section className="chat-settings-section">
          <h3 className="chat-settings-section-title">Persona</h3>
          <div title="Change who you're playing without disturbing the conversation so far">
            <StartScreenPicker
              className="start-screen-picker-compact start-screen-picker-settings"
              value={personaId}
              onChange={onPersonaChange}
              options={personaPickerOptions}
              placeholder="Select…"
              ariaLabel="Persona"
            />
          </div>
        </section>
      )}
      </AutomationLock>

      {conversationId && (
        <AutomationLock
          locked={automationLocked}
          message={
            <>
              <strong>Locked during an automated run</strong>
              <span>The scene note is part of what the run is testing.</span>
            </>
          }
        >
          <section className="chat-settings-section">
            <h3 className="chat-settings-section-title">
              Scene
              <SettingsInfoTip ariaLabel="About the scene note">
                Where the story is right now, in a sentence or two. It is shown to the model on every turn until you
                change it, so it keeps the story in place when the characters move on from the scenario&apos;s
                starting setup. Leave it empty if the setting doesn&apos;t matter.
              </SettingsInfoTip>
            </h3>
            <LimitedTextarea
              value={sceneDraft}
              onChange={(e) => setSceneDraft(e.target.value)}
              onBlur={() => {
                if (sceneDraft.trim() !== sceneNote.trim()) onSceneNoteSave(sceneDraft);
              }}
              limit={FIELD_LIMITS.sceneNote}
              rows={3}
              compactCount
              copyable
              placeholder="e.g. Deep in the sandstone tunnels under the Prism Spire, hiding from searchers."
            />
            <label className="chat-settings-checkbox">
              <input
                type="checkbox"
                checked={sceneSuggestions}
                onChange={(e) => onSceneSuggestionsChange(e.target.checked)}
              />
              Offer to update it when the scene changes
            </label>
          </section>
        </AutomationLock>
      )}

      <section className="chat-settings-section">
        <h3 className="chat-settings-section-title">Display</h3>

        <label className="chat-settings-field">
          <span className="chat-settings-field-label">Chat text size</span>
          <select
            value={fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value) as ChatFontSize)}
          >
            {CHAT_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </label>

        {showPortraitsToggle && (
          <label className="chat-settings-field">
            <span className="chat-settings-field-label chat-settings-field-label-row">
              Portraits
              <SettingsInfoTip ariaLabel="How Portraits works">
                <p>
                  Sets whether character and persona portraits are shown in the chat margins.
                </p>
              </SettingsInfoTip>
            </span>
            <select
              value={portraitsTooNarrow ? 'hidden' : showPortraits ? 'on' : 'off'}
              disabled={portraitsTooNarrow}
              onChange={(e) => onShowPortraitsChange(e.target.value === 'on')}
            >
              {portraitsTooNarrow ? (
                <option value="hidden">Off — hidden by default on small screens</option>
              ) : (
                <>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </>
              )}
            </select>
          </label>
        )}
      </section>

      {speechAvailable && (
        <section className="chat-settings-section">
          <h3 className="chat-settings-section-title">Speech</h3>

          {speechActive && (
            <label className="chat-settings-field">
              <span className="chat-settings-field-label chat-settings-field-label-row">
                New speech
                <SettingsInfoTip ariaLabel="How Interrupt and Queue work">
                  <dl>
                    <div>
                      <dt>Interrupt</dt>
                      <dd>Cuts off the line that&apos;s playing when the next one is ready.</dd>
                    </div>
                    <div>
                      <dt>Queue</dt>
                      <dd>Waits until the current line finishes, then plays the next.</dd>
                    </div>
                  </dl>
                  <p>Either way, two voices never overlap.</p>
                </SettingsInfoTip>
              </span>
              <select
                value={overlapMode}
                onChange={(e) => onOverlapModeChange(e.target.value as TtsOverlapMode)}
              >
                <option value="interrupt">Interrupt</option>
                <option value="queue">Queue</option>
              </select>
            </label>
          )}

          <label className="chat-settings-checkbox" title="Thoughts and actions in *asterisks* are never spoken -- only spoken dialogue is">
            <input
              type="checkbox"
              checked={skipItalics}
              onChange={(e) => onSkipItalicsChange(e.target.checked)}
            />
            Skip reading italicized thoughts/actions
          </label>

          {characterSpeechAvailable && (
            <label className="chat-settings-field">
              <span className="chat-settings-field-label chat-settings-field-label-row">
                Character speech
                <SettingsInfoTip ariaLabel="How Character speech modes work">
                  <dl>
                    <div>
                      <dt>Off</dt>
                      <dd>No speech on character replies.</dd>
                    </div>
                    <div>
                      <dt>Auto</dt>
                      <dd>Generate and play when the reply lands.</dd>
                    </div>
                    <div>
                      <dt>Manual</dt>
                      <dd>Click Speak on the message to generate and play.</dd>
                    </div>
                  </dl>
                </SettingsInfoTip>
              </span>
              <select
                value={characterTrack}
                onChange={(e) => onCharacterTrackChange(e.target.value as TtsTrackMode)}
              >
                <option value="off">Off</option>
                <option value="auto">Auto</option>
                <option value="click">Manual</option>
              </select>
            </label>
          )}

          {characterSpeechAvailable && characterTrack !== 'off' && (
            <label className="chat-settings-field">
              <span className="chat-settings-field-label chat-settings-field-label-row">
                Who reads reply
                <SettingsInfoTip ariaLabel="How Who reads reply works">
                  <dl>
                    <div>
                      <dt>Character (all)</dt>
                      <dd>The character voice reads the entire reply.</dd>
                    </div>
                    <div>
                      <dt>Narrator (all)</dt>
                      <dd>The narrator voice reads the entire reply.</dd>
                    </div>
                    <div>
                      <dt>Split italics</dt>
                      <dd>
                        Italic text <em>*like this*</em> is read by the narrator; the rest is read
                        by the character.
                      </dd>
                    </div>
                  </dl>
                </SettingsInfoTip>
              </span>
              <select
                value={readingMode}
                onChange={(e) => onReadingModeChange(e.target.value as TtsReadingMode)}
              >
                <option value="character">Character (all)</option>
                <option value="narrator" disabled={!narratorVoice}>
                  Narrator (all)
                </option>
                <option value="split" disabled={!canSplitCharacter || skipItalics}>
                  Split italics
                </option>
              </select>
            </label>
          )}

          {personaSpeechAvailable && (
            <label className="chat-settings-field">
              <span className="chat-settings-field-label chat-settings-field-label-row">
                Persona speech
                <SettingsInfoTip ariaLabel="How Persona speech modes work">
                  <dl>
                    <div>
                      <dt>Off</dt>
                      <dd>No speech on persona lines.</dd>
                    </div>
                    <div>
                      <dt>Auto</dt>
                      <dd>Generate and play when the line lands.</dd>
                    </div>
                    <div>
                      <dt>Manual</dt>
                      <dd>Click Speak on the message to generate and play.</dd>
                    </div>
                  </dl>
                </SettingsInfoTip>
              </span>
              <select
                value={personaTrack}
                onChange={(e) => onPersonaTrackChange(e.target.value as TtsTrackMode)}
              >
                <option value="off">Off</option>
                <option value="auto">Auto</option>
                <option value="click">Manual</option>
              </select>
            </label>
          )}

          {personaSpeechAvailable && personaTrack !== 'off' && (
            <label className="chat-settings-field">
              <span className="chat-settings-field-label chat-settings-field-label-row">
                Who reads your persona
                <SettingsInfoTip ariaLabel="How Who reads your persona works">
                  <dl>
                    <div>
                      <dt>Persona (all)</dt>
                      <dd>The persona voice reads the entire line.</dd>
                    </div>
                    <div>
                      <dt>Narrator (all)</dt>
                      <dd>The narrator voice reads the entire line.</dd>
                    </div>
                    <div>
                      <dt>Split italics</dt>
                      <dd>
                        Italic text <em>*like this*</em> is read by the narrator; the rest is read
                        by the persona.
                      </dd>
                    </div>
                  </dl>
                </SettingsInfoTip>
              </span>
              <select
                value={personaReadingMode}
                onChange={(e) => onPersonaReadingModeChange(e.target.value as TtsReadingMode)}
              >
                <option value="character">Persona (all)</option>
                <option value="narrator" disabled={!narratorVoice}>
                  Narrator (all)
                </option>
                <option value="split" disabled={!canSplitPersona || skipItalics}>
                  Split italics
                </option>
              </select>
            </label>
          )}
        </section>
      )}

      {conversationId && (
        <section className="chat-settings-section">
          <h3 className="chat-settings-section-title">Retention</h3>
          <label
            className="chat-settings-checkbox"
            title="Retention rules in Settings will not delete this conversation or its spoken audio"
          >
            <input
              type="checkbox"
              checked={keepForever}
              onChange={(e) => onKeepForeverChange(e.target.checked)}
            />
            Keep this conversation
          </label>
          <p className="text-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            Retention rules in Settings → Data will not delete this chat or its spoken audio.
          </p>
        </section>
      )}

      <AutomationLock
        locked={automationLocked}
        message={
          <>
            <strong>Locked during an automated run</strong>
            <span>Changing how replies are written midway would make the run's log misleading.</span>
          </>
        }
      >
      <section className="chat-settings-section">
        <h3 className="chat-settings-section-title">
          Reply style
          <SettingsInfoTip ariaLabel="About reply style">
            Global, not per-conversation -- these apply to every chat so you can flip them and
            compare against the same conversation instead of needing a fresh one to test.
          </SettingsInfoTip>
        </h3>

        <label className="chat-settings-checkbox">
          <input
            type="checkbox"
            checked={conciseReplies}
            onChange={(e) => onConciseRepliesChange(e.target.checked)}
          />
          Nudge replies to be shorter and more conversational
        </label>

        <label className="chat-settings-field">
          <span className="chat-settings-field-label">Narration point of view</span>
          <select
            value={narrationPov ?? ''}
            onChange={(e) => onNarrationPovChange((e.target.value || null) as 'first' | 'third' | null)}
          >
            <option value="">Model's default</option>
            <option value="first">First person ("I" / "you")</option>
            <option value="third">Third person actions, first-person dialogue</option>
          </select>
        </label>
      </section>
      </AutomationLock>

      <AutomationLock
        locked={automationLocked}
        message={
          <>
            <strong>Locked during an automated run</strong>
            <span>The run uses the values it started with.</span>
          </>
        }
      >
      <section className="chat-settings-section">
        <h3 className="chat-settings-section-title">AI model tuning</h3>

        <label className="chat-slider chat-settings-slider">
          Temperature <output>{samplers.temperature.toFixed(2)}</output>
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.1}
            value={samplers.temperature}
            onChange={(e) => onSamplersChange({ ...samplers, temperature: Number(e.target.value) })}
          />
          <button
            type="button"
            className="chat-slider-reset"
            title={`Reset to default (${defaultSamplers.temperature.toFixed(2)})`}
            disabled={samplers.temperature === defaultSamplers.temperature}
            onClick={() => onSamplersChange({ ...samplers, temperature: defaultSamplers.temperature })}
          >
            ↺
          </button>
        </label>

        <label className="chat-slider chat-settings-slider">
          Max tokens <output>{samplers.maxTokens}</output>
          <input
            type="range"
            min={64}
            max={512}
            step={64}
            value={samplers.maxTokens}
            onChange={(e) => onSamplersChange({ ...samplers, maxTokens: Number(e.target.value) })}
          />
          <button
            type="button"
            className="chat-slider-reset"
            title={`Reset to default (${defaultSamplers.maxTokens})`}
            disabled={samplers.maxTokens === defaultSamplers.maxTokens}
            onClick={() => onSamplersChange({ ...samplers, maxTokens: defaultSamplers.maxTokens })}
          >
            ↺
          </button>
        </label>
      </section>
      </AutomationLock>
    </div>
  );
}
