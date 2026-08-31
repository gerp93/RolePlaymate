import { useCallback, useEffect, useRef, useState } from 'react';
import { CharacterTtsVoice } from '../../shared/types/tts';
import { planSpeechClips, TtsOverlapMode, TtsReadingMode, TtsSpeechClip, TtsTrackMode } from '../../shared/utils/ttsSegments';
import { toImageUrl } from '../utils/imageUrl';

const TTS_AUTOPLAY_KEY = 'roleplaymate-chat-tts-autoplay';
const TTS_CHARACTER_TRACK_KEY = 'roleplaymate-chat-tts-character-track';
const TTS_PERSONA_TRACK_KEY = 'roleplaymate-chat-tts-persona-track';
const TTS_READING_KEY = 'roleplaymate-chat-tts-reading';
const TTS_PERSONA_READING_KEY = 'roleplaymate-chat-tts-persona-reading';
const TTS_OVERLAP_KEY = 'roleplaymate-chat-tts-overlap';
const EQ_FFT_SIZE = 64;
const MAX_SPEAK_QUEUE = 8;

/** Minimal silent WAV. Playing it during a click/keypress unlocks later HTMLAudioElement.play()
 * after the long Chatterbox round-trip, which Chromium otherwise treats as unsolicited autoplay. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAABAAgAZGF0YQAAAAA=';

function parseTrack(value: string | null): TtsTrackMode | null {
  if (value === 'off' || value === 'auto' || value === 'click') return value;
  return null;
}

function getStoredCharacterTrack(): TtsTrackMode {
  try {
    const stored = parseTrack(localStorage.getItem(TTS_CHARACTER_TRACK_KEY));
    if (stored) return stored;
    const legacy = localStorage.getItem(TTS_AUTOPLAY_KEY);
    if (legacy === 'false') return 'click';
  } catch {
    // localStorage not available
  }
  return 'auto';
}

function saveStoredCharacterTrack(value: TtsTrackMode): void {
  try {
    localStorage.setItem(TTS_CHARACTER_TRACK_KEY, value);
  } catch {
    // localStorage not available
  }
}

function getStoredPersonaTrack(): TtsTrackMode {
  try {
    return parseTrack(localStorage.getItem(TTS_PERSONA_TRACK_KEY)) ?? 'off';
  } catch {
    return 'off';
  }
}

function saveStoredPersonaTrack(value: TtsTrackMode): void {
  try {
    localStorage.setItem(TTS_PERSONA_TRACK_KEY, value);
  } catch {
    // localStorage not available
  }
}

function getStoredReadingMode(key: string): TtsReadingMode {
  try {
    const value = localStorage.getItem(key);
    if (value === 'character' || value === 'narrator' || value === 'split') return value;
  } catch {
    // localStorage not available
  }
  return 'character';
}

function saveStoredReadingMode(key: string, value: TtsReadingMode): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage not available
  }
}

function getStoredOverlapMode(): TtsOverlapMode {
  try {
    const value = localStorage.getItem(TTS_OVERLAP_KEY);
    if (value === 'queue' || value === 'interrupt') return value;
  } catch {
    // localStorage not available
  }
  return 'interrupt';
}

function saveStoredOverlapMode(value: TtsOverlapMode): void {
  try {
    localStorage.setItem(TTS_OVERLAP_KEY, value);
  } catch {
    // localStorage not available
  }
}

function decodeBase64Audio(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Call from a user gesture (Send, Speak, Continue) before awaiting TTS. */
export function unlockSpeechPlayback(): void {
  const audio = new Audio(SILENT_WAV);
  audio.volume = 0;
  void audio
    .play()
    .then(() => {
      audio.pause();
      audio.src = '';
    })
    .catch(() => {
      // Already outside a gesture, or autoplay is unrestricted in this Electron build.
    });
}

interface SpeakVoices {
  speakerVoice: CharacterTtsVoice | null;
  narratorVoice: CharacterTtsVoice | null;
}

interface SpeakPersist {
  messageId: string;
  variantId: string | null;
}

interface SpeakJob {
  text: string;
  voices: SpeakVoices;
  readingMode: TtsReadingMode;
  reportErrors?: boolean;
  persist?: SpeakPersist;
  savedPath?: string | null;
}

interface PreparedClip {
  url: string;
  mimeType: string;
  data: string;
  objectUrl: boolean;
}

/**
 * Plays Chatterbox audio in the renderer. Synthesis stays in the main process (localhost
 * HTTP); this only turns the returned WAV into an HTMLAudioElement. A down server is silent
 * on auto-play, never a chat error — manual Speak reports it.
 *
 * Same-voice replies stay one request. Split mode queues italic/narrator vs character clips
 * and fetches the next while the current one plays. A completed generation is written beside
 * the database so later Play skips Chatterbox.
 */
export function useTtsPlayback() {
  const [characterTrack, setCharacterTrackState] = useState(getStoredCharacterTrack);
  const [personaTrack, setPersonaTrackState] = useState(getStoredPersonaTrack);
  const [readingMode, setReadingModeState] = useState(() => getStoredReadingMode(TTS_READING_KEY));
  const [personaReadingMode, setPersonaReadingModeState] = useState(() =>
    getStoredReadingMode(TTS_PERSONA_READING_KEY)
  );
  const [overlapMode, setOverlapModeState] = useState(getStoredOverlapMode);
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const leftoverUrlsRef = useRef<string[]>([]);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const queueRef = useRef<SpeakJob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const endedWaiterRef = useRef<{ resolve: () => void; reject: (err: Error) => void } | null>(null);
  const pendingStoreRef = useRef<Map<string, { path: string; variantId: string | null }>>(new Map());
  const persistAliasRef = useRef<Map<string, string>>(new Map());
  const onAudioSavedRef = useRef<(messageId: string, path: string, variantId: string | null) => void>();
  const drainQueueRef = useRef<() => void>(() => {});

  const disposeAudio = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audioRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setAnalyser(null);
  };

  const revokeLeftovers = () => {
    for (const url of leftoverUrlsRef.current) URL.revokeObjectURL(url);
    leftoverUrlsRef.current = [];
  };

  const attachAnalyser = (audio: HTMLAudioElement): AnalyserNode | null => {
    try {
      let ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioContext();
        audioContextRef.current = ctx;
      }
      if (ctx.state === 'suspended') void ctx.resume();
      const source = ctx.createMediaElementSource(audio);
      const node = ctx.createAnalyser();
      node.fftSize = EQ_FFT_SIZE;
      node.smoothingTimeConstant = 0.65;
      source.connect(node);
      node.connect(ctx.destination);
      return node;
    } catch {
      return null;
    }
  };

  const stop = useCallback(() => {
    generationRef.current += 1;
    inFlightRef.current = false;
    queueRef.current = [];
    endedWaiterRef.current?.reject(new Error('cancelled'));
    endedWaiterRef.current = null;
    disposeAudio();
    revokeLeftovers();
    setGenerating(false);
    setPlaying(false);
    setPaused(false);
    setActiveMessageId(null);
    setActiveVariantId(null);
    void window.electronAPI.tts.cancel();
  }, []);

  const setCharacterTrack = useCallback((value: TtsTrackMode) => {
    setCharacterTrackState(value);
    saveStoredCharacterTrack(value);
  }, []);

  const setPersonaTrack = useCallback((value: TtsTrackMode) => {
    setPersonaTrackState(value);
    saveStoredPersonaTrack(value);
  }, []);

  const setReadingMode = useCallback((value: TtsReadingMode) => {
    setReadingModeState(value);
    saveStoredReadingMode(TTS_READING_KEY, value);
  }, []);

  const setPersonaReadingMode = useCallback((value: TtsReadingMode) => {
    setPersonaReadingModeState(value);
    saveStoredReadingMode(TTS_PERSONA_READING_KEY, value);
  }, []);

  const setOverlapMode = useCallback((value: TtsOverlapMode) => {
    setOverlapModeState(value);
    saveStoredOverlapMode(value);
  }, []);

  const pause = useCallback(() => {
    if (inFlightRef.current && !audioRef.current) {
      stop();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    setPaused(true);
  }, [stop]);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    unlockSpeechPlayback();
    void audio
      .play()
      .then(() => {
        setPaused(false);
        setPlaying(true);
      })
      .catch(() => {
        setError('Could not resume playback.');
      });
  }, []);

  useEffect(
    () => () => {
      stop();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    },
    [stop]
  );

  const persistClips = async (job: SpeakJob, clips: { mimeType: string; data: string }[]) => {
    if (!job.persist || clips.length === 0) return;
    const result = await window.electronAPI.tts.storeAudio({
      messageId: job.persist.messageId,
      variantId: job.persist.variantId,
      clips,
    });
    if (result.status !== 'ok') return;
    const aliased = persistAliasRef.current.get(job.persist.messageId);
    const realId = aliased ?? job.persist.messageId;
    if (realId.startsWith('pending-')) {
      pendingStoreRef.current.set(job.persist.messageId, {
        path: result.path,
        variantId: job.persist.variantId,
      });
      onAudioSavedRef.current?.(job.persist.messageId, result.path, job.persist.variantId);
      return;
    }
    if (realId !== job.persist.messageId || !result.attached) {
      const attached = await window.electronAPI.tts.attachAudio({
        messageId: realId,
        variantId: job.persist.variantId,
        path: result.path,
      });
      if (attached.status === 'ok') onAudioSavedRef.current?.(realId, attached.path, job.persist.variantId);
      return;
    }
    onAudioSavedRef.current?.(realId, result.path, job.persist.variantId);
  };

  const synthesize = async (
    clip: TtsSpeechClip,
    generation: number,
    reportErrors: boolean | undefined
  ): Promise<PreparedClip | null> => {
    const result = await window.electronAPI.tts.speak({ text: clip.text, voice: clip.voice });
    if (generation !== generationRef.current) return null;
    if (result.status === 'ok') {
      const mime = result.mimeType.startsWith('audio/') ? result.mimeType : 'audio/wav';
      const blob = new Blob([decodeBase64Audio(result.data)], { type: mime });
      const url = URL.createObjectURL(blob);
      leftoverUrlsRef.current.push(url);
      return { url, mimeType: mime, data: result.data, objectUrl: true };
    }
    if (result.status === 'busy' || result.status === 'cancelled') return null;
    if (result.status === 'unavailable') {
      if (reportErrors) {
        setError('Chatterbox is not running. Start the TTS server, then try Speak again.');
      }
      return null;
    }
    if (result.status === 'skipped') {
      if (reportErrors) setError('Nothing to speak in that message.');
      return null;
    }
    if (reportErrors) setError(result.message);
    return null;
  };

  const playPrepared = (clip: PreparedClip, generation: number, reportErrors: boolean | undefined) =>
    new Promise<void>((resolve, reject) => {
      leftoverUrlsRef.current = leftoverUrlsRef.current.filter((url) => url !== clip.url);
      disposeAudio();
      const audio = new Audio(clip.url);
      audioRef.current = audio;
      if (clip.objectUrl) objectUrlRef.current = clip.url;
      const node = attachAnalyser(audio);
      setAnalyser(node);
      setGenerating(false);
      setPaused(false);
      setPlaying(true);
      let settled = false;

      const finish = (ok: boolean, err?: Error) => {
        if (settled) return;
        settled = true;
        endedWaiterRef.current = null;
        if (clip.objectUrl && objectUrlRef.current === clip.url) {
          URL.revokeObjectURL(clip.url);
          objectUrlRef.current = null;
        }
        if (audioRef.current === audio) {
          audioRef.current = null;
          setAnalyser(null);
          setPlaying(false);
        }
        if (ok) resolve();
        else reject(err ?? new Error('playback failed'));
      };

      endedWaiterRef.current = {
        resolve: () => finish(true),
        reject: (err) => finish(false, err),
      };

      audio.onended = () => {
        if (generation !== generationRef.current) return;
        finish(true);
      };
      audio.onerror = () => {
        if (generation !== generationRef.current) return;
        if (reportErrors) setError('Could not play the generated audio.');
        finish(false, new Error('Could not play the generated audio.'));
      };
      void audio.play().catch((err) => {
        if (generation !== generationRef.current) return;
        if (reportErrors) setError('Could not play the generated audio.');
        finish(false, err instanceof Error ? err : new Error('Could not play voice.'));
      });
    });

  const executeSpeak = async (job: SpeakJob) => {
    const messageId = job.persist?.messageId ?? null;
    const variantId = job.persist?.variantId ?? null;
    setActiveMessageId(messageId);
    setActiveVariantId(variantId);

    const clearActive = () => {
      setActiveMessageId(null);
      setActiveVariantId(null);
    };

    if (job.savedPath) {
      unlockSpeechPlayback();
      disposeAudio();
      revokeLeftovers();
      const generation = generationRef.current;
      setError(null);
      setPaused(false);
      setGenerating(false);
      try {
        await playPrepared(
          { url: toImageUrl(job.savedPath), mimeType: 'audio/wav', data: '', objectUrl: false },
          generation,
          job.reportErrors
        );
        if (generation === generationRef.current) {
          setGenerating(false);
          setPlaying(false);
          setPaused(false);
          clearActive();
        }
        return;
      } catch {
        if (generation !== generationRef.current) return;
        // File missing or unreadable -- fall through to Chatterbox.
      }
    }

    const clips = planSpeechClips(job.text, job.readingMode, job.voices.speakerVoice, job.voices.narratorVoice);
    if (clips.length === 0) {
      if (job.reportErrors) {
        if (!job.voices.speakerVoice && !job.voices.narratorVoice) {
          setError('No spoken voice is set. Pick one on the character, persona, or in Settings.');
        } else {
          setError('Nothing to speak in that message.');
        }
      }
      clearActive();
      return;
    }

    unlockSpeechPlayback();
    disposeAudio();
    revokeLeftovers();
    const generation = generationRef.current;
    setError(null);
    setPlaying(false);
    setPaused(false);
    setGenerating(true);

    const clipData: { mimeType: string; data: string }[] = [];
    let stored = false;

    try {
      let next = synthesize(clips[0], generation, job.reportErrors);
      for (let i = 0; i < clips.length; i++) {
        if (generation !== generationRef.current) return;
        const prepared = await next;
        if (generation !== generationRef.current) return;
        if (!prepared) {
          setGenerating(false);
          setPlaying(false);
          clearActive();
          return;
        }
        clipData.push({ mimeType: prepared.mimeType, data: prepared.data });
        if (!stored && clipData.length === clips.length) {
          stored = true;
          void persistClips(job, clipData);
        }
        if (i + 1 < clips.length) {
          next = synthesize(clips[i + 1], generation, job.reportErrors);
        }
        try {
          await playPrepared(prepared, generation, job.reportErrors);
        } catch {
          if (generation !== generationRef.current) return;
          setGenerating(false);
          setPlaying(false);
          setPaused(false);
          clearActive();
          return;
        }
        if (i + 1 < clips.length && generation === generationRef.current) {
          setGenerating(true);
          setPlaying(false);
        }
      }
      if (generation === generationRef.current) {
        setGenerating(false);
        setPlaying(false);
        setPaused(false);
        clearActive();
      }
    } catch (err) {
      if (generation !== generationRef.current) return;
      setGenerating(false);
      setPlaying(false);
      setPaused(false);
      clearActive();
      if (job.reportErrors) {
        setError(err instanceof Error ? err.message : 'Could not play voice.');
      }
    } finally {
      if (generation === generationRef.current) revokeLeftovers();
    }
  };

  const drainQueue = () => {
    if (inFlightRef.current) return;
    const job = queueRef.current.shift();
    if (!job) return;
    inFlightRef.current = true;
    const generation = generationRef.current;
    void executeSpeak(job).finally(() => {
      if (generation !== generationRef.current) return;
      inFlightRef.current = false;
      drainQueue();
    });
  };
  drainQueueRef.current = drainQueue;

  /** Cut the current clip and start the next queued line. Leaves the rest of the queue intact. */
  const skip = useCallback(() => {
    if (!inFlightRef.current && !audioRef.current) return;
    generationRef.current += 1;
    inFlightRef.current = false;
    endedWaiterRef.current?.reject(new Error('skipped'));
    endedWaiterRef.current = null;
    disposeAudio();
    revokeLeftovers();
    setGenerating(false);
    setPlaying(false);
    setPaused(false);
    setActiveMessageId(null);
    setActiveVariantId(null);
    void window.electronAPI.tts.cancel();
    drainQueueRef.current();
  }, []);

  const speak = useCallback(
    (
      text: string,
      voices: SpeakVoices,
      opts?: {
        reportErrors?: boolean;
        readingMode?: TtsReadingMode;
        persist?: SpeakPersist;
        savedPath?: string | null;
        replace?: boolean;
      }
    ) => {
      if (!text.trim()) return;
      const reading = opts?.readingMode ?? readingMode;
      if (!opts?.savedPath) {
        const clips = planSpeechClips(text, reading, voices.speakerVoice, voices.narratorVoice);
        if (clips.length === 0) {
          if (opts?.reportErrors) {
            if (!voices.speakerVoice && !voices.narratorVoice) {
              setError('No spoken voice is set. Pick one on the character, persona, or in Settings.');
            } else {
              setError('Nothing to speak in that message.');
            }
          }
          return;
        }
      }
      const job: SpeakJob = {
        text,
        voices,
        readingMode: reading,
        reportErrors: opts?.reportErrors,
        persist: opts?.persist,
        savedPath: opts?.savedPath,
      };
      // Click-to-play always cuts in. Auto-play follows Chat Settings: interrupt the current
      // clip, or wait in line. Either path plays one clip at a time.
      const cutIn = opts?.replace || overlapMode === 'interrupt';
      if (cutIn) {
        stop();
        queueRef.current = [job];
        drainQueue();
        return;
      }
      if (inFlightRef.current) {
        queueRef.current.push(job);
        if (queueRef.current.length > MAX_SPEAK_QUEUE) queueRef.current.shift();
        return;
      }
      queueRef.current.push(job);
      drainQueue();
    },
    [readingMode, overlapMode, stop]
  );

  const rebindPersistedAudio = useCallback(async (fromId: string, toId: string) => {
    persistAliasRef.current.set(fromId, toId);
    if (activeMessageId === fromId) setActiveMessageId(toId);
    const pending = pendingStoreRef.current.get(fromId);
    if (!pending) return;
    pendingStoreRef.current.delete(fromId);
    const attached = await window.electronAPI.tts.attachAudio({
      messageId: toId,
      variantId: pending.variantId,
      path: pending.path,
    });
    if (attached.status === 'ok') onAudioSavedRef.current?.(toId, attached.path, pending.variantId);
  }, [activeMessageId]);

  const setOnAudioSaved = useCallback(
    (handler: ((messageId: string, path: string, variantId: string | null) => void) | undefined) => {
      onAudioSavedRef.current = handler;
    },
    []
  );

  return {
    characterTrack,
    setCharacterTrack,
    personaTrack,
    setPersonaTrack,
    readingMode,
    setReadingMode,
    personaReadingMode,
    setPersonaReadingMode,
    overlapMode,
    setOverlapMode,
    generating,
    playing,
    paused,
    analyser,
    error,
    activeMessageId,
    activeVariantId,
    speak,
    pause,
    resume,
    skip,
    stop,
    rebindPersistedAudio,
    setOnAudioSaved,
    dismissError: () => setError(null),
  };
}
