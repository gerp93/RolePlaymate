/** How a character's assigned Chatterbox voice is resolved -- a stock file in `voices/`
 * versus a reference clip in `reference_audio/`. Null on the character means no speech. */
export type TtsVoiceMode = 'predefined' | 'clone';

export interface CharacterTtsVoice {
  mode: TtsVoiceMode;
  /** Filename only (no path). Chatterbox sandboxes this under the matching directory. */
  id: string;
}

export function parseTtsVoice(mode: string | null, id: string | null): CharacterTtsVoice | null {
  const parsedMode = mode?.trim() ?? '';
  const parsedId = id?.trim().replace(/^.*[/\\]/, '') ?? '';
  if ((parsedMode !== 'predefined' && parsedMode !== 'clone') || !parsedId) return null;
  return { mode: parsedMode, id: parsedId };
}

export interface ChatterboxPredefinedVoice {
  displayName: string;
  filename: string;
}

export interface ChatterboxCloneVoice {
  filename: string;
  displayName: string;
}

export interface ChatterboxHostInfo {
  host: string;
  isDefault: boolean;
  defaultHost: string;
}

/** Snapshot of whether the local Chatterbox server is usable, plus the voices it currently
 * has on disk. Empty lists when unreachable -- the library and chat do not depend on this. */
export interface ChatterboxStatus {
  reachable: boolean;
  host: string;
  predefined: ChatterboxPredefinedVoice[];
  clones: ChatterboxCloneVoice[];
}

export interface TtsSpeakRequest {
  text: string;
  voice: CharacterTtsVoice;
}

export type TtsSpeakResult =
  | { status: 'ok'; mimeType: string; data: string }
  | { status: 'unavailable' }
  | { status: 'skipped' }
  | { status: 'busy' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface TtsAudioClip {
  mimeType: string;
  data: string;
}

export interface TtsStoreAudioRequest {
  messageId: string;
  variantId?: string | null;
  clips: TtsAudioClip[];
}

export type TtsStoreAudioResult =
  | { status: 'ok'; path: string; attached: boolean }
  | { status: 'error'; message: string };

export interface TtsAttachAudioRequest {
  messageId: string;
  variantId?: string | null;
  path: string;
}

export type TtsImportCloneResult =
  | { status: 'ok'; filename: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export type TtsDeleteCloneResult =
  | { status: 'ok'; narratorCleared: boolean }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export type TtsRevealCloneFolderResult =
  | { status: 'ok' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };
