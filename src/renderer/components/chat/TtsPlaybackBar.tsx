import { useEffect, useRef } from 'react';
import { TtsTrackMode } from '../../../shared/utils/ttsSegments';

/** Wide enough to read as an EQ, few enough that every bar can sit on voice energy
 * (speech lives in the low bins; stretching 18 bars across the full FFT left the
 * right half sitting on silence). */
const BAR_COUNT = 10;
/** Analyser bins above this fraction of Nyquist are empty for spoken voice. */
const VOICE_BIN_FRACTION = 0.4;

interface Props {
  trackMode: TtsTrackMode;
  hasAudio: boolean;
  active: boolean;
  generating: boolean;
  playing: boolean;
  paused: boolean;
  analyser: AnalyserNode | null;
  speakerName: string;
  onPlay: () => void;
  onPause: () => void;
  onGenerate: () => void;
}

export default function MessageTtsControls({
  trackMode,
  hasAudio,
  active,
  generating,
  playing,
  paused,
  analyser,
  speakerName,
  onPlay,
  onPause,
  onGenerate,
}: Props) {
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const synthesizing = active && generating && !playing;
  const live = active && playing;

  useEffect(() => {
    if (synthesizing) return;
    const data = analyser && active ? new Uint8Array(analyser.frequencyBinCount) : null;
    let frame = 0;

    const tick = () => {
      const bars = barRefs.current;
      if (analyser && data && active && playing) {
        analyser.getByteFrequencyData(data);
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
        const rest = active && paused ? 0.18 : 0.08;
        for (let i = 0; i < BAR_COUNT; i++) {
          if (bars[i]) bars[i]!.style.transform = `scaleY(${rest})`;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyser, active, synthesizing, playing, paused]);

  const showGenerate = trackMode === 'click';
  const showPause = active && playing;
  const showPlay = !synthesizing && !showPause;
  const voiceLabel = speakerName.trim() || 'them';

  return (
    <div className="chat-tts-tray">
      {synthesizing ? (
        <button
          type="button"
          className="chat-tts-control chat-tts-control-wait"
          title="Cancel speech"
          aria-label={`Voicing ${voiceLabel}. Click to cancel.`}
          onClick={onPause}
        >
          <span className="chat-tts-spinner" aria-hidden />
          <span className="chat-tts-wait-label">Voicing {voiceLabel}…</span>
        </button>
      ) : (
        <div
          className={`chat-tts-control${live ? ' is-live' : ''}${active && paused ? ' is-paused' : ''}`}
        >
          <div className="chat-tts-eq chat-tts-eq-tray" aria-hidden>
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <span
                key={i}
                className="chat-tts-eq-bar"
                ref={(el) => {
                  barRefs.current[i] = el;
                }}
              />
            ))}
          </div>
          {showPlay && (
            <button
              type="button"
              className="chat-tts-control-btn"
              title={active && paused ? 'Resume' : hasAudio ? 'Play' : 'Generate and play'}
              aria-label={active && paused ? 'Resume speech' : hasAudio ? 'Play speech' : 'Generate and play speech'}
              onClick={onPlay}
            >
              ▶
            </button>
          )}
          {showPause && (
            <button
              type="button"
              className="chat-tts-control-btn"
              title="Pause"
              aria-label="Pause speech"
              onClick={onPause}
            >
              ⏸
            </button>
          )}
        </div>
      )}
      {showGenerate && !synthesizing && (
        <button
          type="button"
          className="chat-variant-btn"
          title={hasAudio ? 'Regenerate speech' : 'Generate speech'}
          aria-label={hasAudio ? 'Regenerate speech' : 'Generate speech'}
          disabled={generating && !active}
          onClick={onGenerate}
        >
          🔊
        </button>
      )}
    </div>
  );
}
