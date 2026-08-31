import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CharacterTtsVoice, ChatterboxStatus } from '../../shared/types/tts';
import { normalizeCloneVoices } from '../../shared/utils/ttsPreview';
import { VoicePreviewState } from '../hooks/useVoicePreview';
import VoicePreview from './VoicePreview';

interface Props {
  value: CharacterTtsVoice | null;
  onChange: (voice: CharacterTtsVoice | null) => void;
  preview: VoicePreviewState;
  label?: string;
  noneLabel?: string;
  description?: ReactNode;
  /** Bump after importing or deleting a clone so the dropdown refetches Chatterbox's list. */
  reloadToken?: number;
}

function voiceKey(voice: CharacterTtsVoice | null): string {
  return voice ? `${voice.mode}:${voice.id}` : '';
}

function parseVoiceKey(value: string): CharacterTtsVoice | null {
  if (!value) return null;
  const colon = value.indexOf(':');
  if (colon <= 0) return null;
  const mode = value.slice(0, colon);
  const id = value.slice(colon + 1).replace(/^.*[/\\]/, '').trim();
  if ((mode !== 'predefined' && mode !== 'clone') || !id) return null;
  return { mode, id };
}

export default function CharacterVoicePicker({
  value,
  onChange,
  preview,
  label = 'Spoken voice',
  noneLabel = "None — use Settings narrator voice if one is set",
  description,
  reloadToken = 0,
}: Props) {
  const [status, setStatus] = useState<ChatterboxStatus | null>(null);
  const incoming = voiceKey(value);
  const [selected, setSelected] = useState(incoming);

  useEffect(() => {
    setSelected(incoming);
  }, [incoming]);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.tts.status().then((next) => {
      if (!cancelled) {
        setStatus({ ...next, clones: normalizeCloneVoices(next.clones) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const selectedMissing =
    value != null &&
    status?.reachable === true &&
    !(value.mode === 'predefined'
      ? status.predefined.some((v) => v.filename === value.id)
      : status.clones.some((v) => v.filename === value.id));

  return (
    <div className="field" style={{ marginTop: 12 }}>
      <div className="voice-picker-row">
        <div className="voice-picker-select">
          <label>{label}</label>
          <select
            value={selected}
            onChange={(e) => {
              const key = e.target.value;
              setSelected(key);
              onChange(parseVoiceKey(key));
            }}
            disabled={status !== null && !status.reachable && !value}
          >
            <option value="">{noneLabel}</option>
            {value && selectedMissing && (
              <option value={incoming}>
                {value.mode === 'clone' ? 'Custom' : 'Chatterbox'}: {value.id} (missing on server)
              </option>
            )}
            {status?.reachable && status.clones.length > 0 && (
              <optgroup label="Custom voices">
                {status.clones.map((voice) => (
                  <option key={`clone:${voice.filename}`} value={`clone:${voice.filename}`}>
                    {voice.displayName}
                  </option>
                ))}
              </optgroup>
            )}
            {status?.reachable && status.predefined.length > 0 && (
              <optgroup label="Chatterbox voices">
                {status.predefined.map((voice) => (
                  <option key={`predefined:${voice.filename}`} value={`predefined:${voice.filename}`}>
                    {voice.displayName}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <VoicePreview voice={value} preview={preview} disabled={status?.reachable === false} />
      </div>
      {preview.error && value && preview.activeKey === incoming && (
        <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
          {preview.error}
        </p>
      )}
      {status && !status.reachable && (
        <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
          Chatterbox isn&apos;t running at {status.host}. Chat still works; spoken replies stay
          silent. Start the server, then pick a voice — see{' '}
          <Link to="/settings?tab=servers">Settings → Chat Dependencies</Link>.
        </p>
      )}
      {description}
    </div>
  );
}
