import { Character, CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';
import { CharacterField } from '../shared/types/characterField';
import { CharacterFieldVersion } from '../shared/types/fieldVersion';
import { CharacterImage } from '../shared/types/characterImage';
import { BuiltPrompt, ChatStreamEvent, ChatSendRequest } from '../shared/types/chat';
import {
  UserPersona,
  CreateUserPersonaInput,
  UpdateUserPersonaInput,
} from '../shared/types/userPersona';
import { Conversation, CreateConversationInput } from '../shared/types/conversation';
import { Message } from '../shared/types/message';

declare global {
  interface Window {
    electronAPI: {
      characters: {
        getAll: () => Promise<Character[]>;
        getById: (id: string) => Promise<Character | null>;
        create: (input: CreateCharacterInput) => Promise<Character>;
        update: (id: string, input: UpdateCharacterInput) => Promise<Character>;
        clone: (id: string) => Promise<Character>;
        delete: (id: string) => Promise<{ success: boolean }>;
        importFromHtml: () => Promise<{ character: Character; warnings: string[] } | null>;
      };
      fields: {
        getByCharacter: (characterId: string) => Promise<CharacterField[]>;
      };
      fieldVersions: {
        getByField: (fieldId: string) => Promise<CharacterFieldVersion[]>;
        getById: (id: string) => Promise<CharacterFieldVersion | null>;
        duplicate: (versionId: string) => Promise<CharacterFieldVersion>;
        updateContent: (id: string, content: string) => Promise<CharacterFieldVersion>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      characterImages: {
        getByCharacter: (characterId: string) => Promise<CharacterImage[]>;
        getAllGroupedByCharacter: () => Promise<Record<string, CharacterImage[]>>;
        add: (characterId: string) => Promise<CharacterImage | null>;
        remove: (id: string) => Promise<{ success: boolean }>;
      };
      dbLocation: {
        get: () => Promise<{ path: string; isDefault: boolean; defaultPath: string }>;
        browseExisting: () => Promise<string | null>;
        browseNew: () => Promise<string | null>;
        set: (newPath: string) => Promise<{ success: boolean }>;
        resetToDefault: () => Promise<{ success: boolean }>;
      };
      chat: {
        previewSystemPrompt: (
          characterId: string,
          options?: { personaId?: string; directions?: string; memories?: string[] }
        ) => Promise<BuiltPrompt>;
        send: (
          request: ChatSendRequest & { characterId: string; personaId?: string; model: string }
        ) => Promise<{ streamId: string }>;
        cancel: (conversationId: string) => Promise<{ cancelled: boolean }>;
        isGenerating: (conversationId: string) => Promise<boolean>;
        /** Returns an unsubscribe function -- call it on effect teardown. */
        onStream: (callback: (payload: ChatStreamEvent) => void) => () => void;
      };
      conversations: {
        getAll: () => Promise<Conversation[]>;
        getById: (id: string) => Promise<Conversation | null>;
        getMessages: (id: string) => Promise<Message[]>;
        create: (input: CreateConversationInput) => Promise<Conversation>;
        rename: (id: string, title: string) => Promise<Conversation>;
        delete: (id: string) => Promise<{ success: true }>;
      };
      ollama: {
        listModels: () => Promise<
          { available: true; models: string[] } | { available: false; models: string[]; message: string }
        >;
      };
      personas: {
        getAll: () => Promise<UserPersona[]>;
        create: (input: CreateUserPersonaInput) => Promise<UserPersona>;
        update: (id: string, input: UpdateUserPersonaInput) => Promise<UserPersona>;
        delete: (id: string) => Promise<{ success: true }>;
      };
      app: {
        getVersion: () => Promise<string>;
      };
      updates: {
        check: () => Promise<{
          status: 'available' | 'not-available' | 'error' | 'unsupported';
          version?: string;
          message?: string;
        }>;
      };
    };
  }
}

export {};
