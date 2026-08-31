import { useCallback, useEffect, useRef, useState } from 'react';
import { CharacterTtsVoice } from '../../shared/types/tts';
import { TTS_VOICE_PREVIEW_TEXT } from '../../shared/utils/ttsPreview';
import { unlockSpeechPlayback } from './useTtsPlayback';

const EQ_FFT_SIZE = 64;

function voiceKey(voice: CharacterTtsVoice): string {
  return `${voice.mode}:${voice.id}`;
}

function decodeBase64Audio(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface VoicePreviewState {
  activeKey: string | null;
  generating: boolean;
  playing: boolean;
  paused: boolean;
  analyser: AnalyserNode | null;
  error: string | null;
  play: (voice: CharacterTtsVoice) => void;
  pause: () => void;
  stop: () => void;
}

export function useVoicePreview(): VoicePreviewState {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const disposeAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    setAnalyser(null);
  }, []);

  const attachAnalyser = useCallback((audio: HTMLAudioElement): AnalyserNode | null => {
    try {
      let ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioContext();
        audioContextRef.current = ctx;
      }
      if (ctx.state === 'suspended') void ctx.resume();
      const source = ctx.createMediaElementSource(audio);
      sourceRef.current = source;
      const node = ctx.createAnalyser();
      node.fftSize = EQ_FFT_SIZE;
      node.smoothingTimeConstant = 0.65;
      source.connect(node);
      node.connect(ctx.destination);
      return node;
    } catch {
      return null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    disposeAudio();
    setGenerating(false);
    setPlaying(false);
    setPaused(false);
    setActiveKey(null);
    void window.electronAPI.tts.cancel();
  }, [disposeAudio]);

  const pause = useCallback(() => {
    if (generating && !audioRef.current) {
      stop();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    setPaused(true);
  }, [generating, stop]);

  const play = useCallback(
    (voice: CharacterTtsVoice) => {
      if (!voice.id) return;
      const key = voiceKey(voice);
      if (activeKey === key && paused && audioRef.current) {
        unlockSpeechPlayback();
        void audioRef.current
          .play()
          .then(() => {
            setPaused(false);
            setPlaying(true);
          })
          .catch(() => setError('Could not resume playback.'));
        return;
      }
      if (activeKey === key && playing) {
        pause();
        return;
      }

      unlockSpeechPlayback();
      generationRef.current += 1;
      const generation = generationRef.current;
      disposeAudio();
      setError(null);
      setActiveKey(key);
      setGenerating(true);
      setPlaying(false);
      setPaused(false);

      void (async () => {
        await window.electronAPI.tts.cancel();
        if (generation !== generationRef.current) return;
        const result = await window.electronAPI.tts.speak({
          text: TTS_VOICE_PREVIEW_TEXT,
          voice,
        });
        if (generation !== generationRef.current) return;
        if (result.status !== 'ok') {
          setGenerating(false);
          setActiveKey(null);
          if (result.status === 'unavailable') {
            setError('Chatterbox is not running.');
          } else if (result.status === 'busy') {
            setError('Speech is already generating. Try again in a moment.');
          } else if (result.status === 'error') {
            setError(result.message);
          }
          return;
        }

        const mime = result.mimeType.startsWith('audio/') ? result.mimeType : 'audio/wav';
        const url = URL.createObjectURL(new Blob([decodeBase64Audio(result.data)], { type: mime }));
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        setAnalyser(attachAnalyser(audio));
        setGenerating(false);
        setPlaying(true);

        audio.onended = () => {
          if (generation !== generationRef.current) return;
          disposeAudio();
          setPlaying(false);
          setPaused(false);
          setActiveKey(null);
        };
        audio.onerror = () => {
          if (generation !== generationRef.current) return;
          setError('Could not play the generated audio.');
          disposeAudio();
          setGenerating(false);
          setPlaying(false);
          setActiveKey(null);
        };
        try {
          await audio.play();
        } catch {
          if (generation !== generationRef.current) return;
          setError('Could not play the generated audio.');
          disposeAudio();
          setGenerating(false);
          setPlaying(false);
          setActiveKey(null);
        }
      })();
    },
    [activeKey, attachAnalyser, disposeAudio, pause, paused, playing]
  );

  useEffect(
    () => () => {
      generationRef.current += 1;
      disposeAudio();
      void window.electronAPI.tts.cancel();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    },
    [disposeAudio]
  );

  return { activeKey, generating, playing, paused, analyser, error, play, pause, stop };
}

export function previewKey(voice: CharacterTtsVoice): string {
  return voiceKey(voice);
}
