import { CharacterTtsVoice } from './tts';

export interface Character {
  id: string;
  name: string;
  description: string | null;
  /** Chatterbox voice for spoken replies. Null means this character stays silent. */
  ttsVoice: CharacterTtsVoice | null;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterInput {
  name: string;
  description?: string;
}

export interface UpdateCharacterInput {
  name?: string;
  description?: string;
  /** Pass `null` to clear. Omitted means leave the current assignment alone. */
  ttsVoice?: CharacterTtsVoice | null;
}
