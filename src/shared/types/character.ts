import { CharacterTtsVoice } from './tts';

export interface Character {
  id: string;
  name: string;
  description: string | null;
  /** Chatterbox voice for spoken replies. Null means this character stays silent. */
  ttsVoice: CharacterTtsVoice | null;
  /** Durable total of messages (both roles) sent in any conversation with this character,
   * counted at send time and never decremented -- deleting a message/conversation later
   * doesn't erase it. See conversationService.appendMessage. */
  messageCount: number;
  isHidden: boolean;
  /** Created in a hurry from a chat's "Respond as" picker (name and a line of description only).
   * Behaves exactly like any character; the only difference is the Characters page lists it in a
   * separate "Quick characters" group until it is promoted. */
  isQuick: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterInput {
  name: string;
  description?: string;
  isQuick?: boolean;
}

export interface UpdateCharacterInput {
  name?: string;
  description?: string;
  /** Pass `null` to clear. Omitted means leave the current assignment alone. */
  ttsVoice?: CharacterTtsVoice | null;
}
