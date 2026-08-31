import { useEffect, useRef } from 'react';
import { CharacterTtsVoice } from '../../shared/types/tts';
import { TTS_VOICE_PREVIEW_TEXT } from '../../shared/utils/ttsPreview';
import { previewKey, VoicePreviewState } from '../hooks/useVoicePreview';
import './VoicePreview.css';

const BAR_COUNT = 10;
const VOICE_BIN_FRACTION = 0.4;

interface Props {
  voice: CharacterTtsVoice | null;
  preview: VoicePreviewState;
  disabled?: boolean;
  /** Field-style label above the EQ. Off in tables that already have a Preview column. */
  showLabel?: boolean;
}

export default function VoicePreview({ voice, preview, disabled, showLabel = true }: Props) {
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const key = voice?.id ? previewKey(voice) : '';
  const active = Boolean(key) && preview.activeKey === key;
  const synthesizing = active && preview.generating && !preview.playing;
  const live = active && preview.playing;

  useEffect(() => {
    if (synthesizing) return;
    const data =
      preview.analyser && active ? new Uint8Array(preview.analyser.frequencyBinCount) : null;
    let frame = 0;

    const tick = () => {
      const bars = barRefs.current;
      if (preview.analyser && data && active && preview.playing) {
        preview.analyser.getByteFrequencyData(data);
        const usable = Math.max(BAR_COUNT, Math.floor(data.length * VOICE_BIN_FRACTION));
        const binSize = Math.max(1, Math.floor(usable / BAR_COUNT));
        for (let i = 0; i < BAR_COUNT; i++) {
          const el = bars[i];
          if (!el) continue;
          let sum = 0;
          const start = i * binSize;
          for (let j = 0; j < binSize; j++) sum += data[start + j] ?? 0;
          const level = Math.max(0.08, sum / binSize / 255);
          el.style.transform = `scaleY(${level.toFixed(3)})`;
        }
      } else {
        const rest = active && preview.paused ? 0.18 : 0.08;
        for (let i = 0; i < BAR_COUNT; i++) {
          if (bars[i]) bars[i]!.style.transform = `scaleY(${rest})`;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [preview.analyser, active, synthesizing, preview.playing, preview.paused]);

  if (!voice?.id) return null;

  const showPause = active && preview.playing;
  const canPlay = !disabled && !synthesizing;

  return (
    <div className={`voice-preview${showLabel ? ' has-label' : ''}`}>
      {showLabel && <span className="voice-preview-label">Preview</span>}
      {synthesizing ? (
        <button
          type="button"
          className="voice-preview-wait"
          title="Cancel preview"
          aria-label="Cancel voice preview"
          onClick={preview.pause}
        >
          <span className="voice-preview-spinner" aria-hidden />
        </button>
      ) : (
        <div
          className={`voice-preview-eq-wrap${live ? ' is-live' : ''}${active && preview.paused ? ' is-paused' : ''}`}
        >
          <div className="voice-preview-eq" aria-hidden>
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <span
                key={i}
                className="voice-preview-eq-bar"
                ref={(el) => {
                  barRefs.current[i] = el;
                }}
              />
            ))}
          </div>
          {showPause ? (
            <button
              type="button"
              className="voice-preview-btn"
              title="Pause"
              aria-label="Pause voice preview"
              onClick={preview.pause}
            >
              ⏸
            </button>
          ) : (
            <button
              type="button"
              className="voice-preview-btn"
              title={`Preview: ${TTS_VOICE_PREVIEW_TEXT}`}
              aria-label="Preview this voice"
              disabled={!canPlay}
              onClick={() => preview.play(voice)}
            >
              ▶
            </button>
          )}
        </div>
      )}
    </div>
  );
}
