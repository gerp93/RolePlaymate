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
import { ConversationMemory } from '../shared/types/conversationMemory';
import {
  Lorebook,
  LorebookEntry,
  LorebookEntryVersion,
  CreateLorebookInput,
  UpdateLorebookInput,
  CreateLorebookEntryInput,
  UpdateLorebookEntryInput,
} from '../shared/types/lorebook';

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
        /** Post-turn extraction result. Also returns an unsubscribe function. */
        onMemoriesUpdated: (
          callback: (payload: { conversationId: string; added: ConversationMemory[] }) => void
        ) => () => void;
      };
      memories: {
        getAll: (conversationId: string) => Promise<ConversationMemory[]>;
        count: (conversationId: string) => Promise<number>;
        /** Added memories are 'manual', i.e. pinned: always injected. */
        add: (conversationId: string, content: string) => Promise<ConversationMemory>;
        update: (id: string, content: string) => Promise<ConversationMemory>;
        delete: (id: string) => Promise<{ success: true }>;
        deleteAll: (conversationId: string) => Promise<{ success: true }>;
      };
      lorebooks: {
        getWorldBooks: () => Promise<Lorebook[]>;
        getById: (id: string) => Promise<Lorebook | null>;
        create: (input: CreateLorebookInput) => Promise<Lorebook>;
        update: (id: string, input: UpdateLorebookInput) => Promise<Lorebook>;
        delete: (id: string) => Promise<{ success: true }>;
        /** Creates the book on first request rather than alongside every character. */
        getPersonalBook: (characterId: string) => Promise<Lorebook>;
        getForCharacter: (
          characterId: string
        ) => Promise<{ world: Lorebook[]; personal: Lorebook | null }>;
        getCharacterIds: (lorebookId: string) => Promise<string[]>;
        attach: (characterId: string, lorebookId: string) => Promise<{ success: true }>;
        detach: (characterId: string, lorebookId: string) => Promise<{ success: true }>;
      };
      loreEntries: {
        getByBook: (lorebookId: string) => Promise<LorebookEntry[]>;
        create: (input: CreateLorebookEntryInput) => Promise<LorebookEntry>;
        update: (id: string, input: UpdateLorebookEntryInput) => Promise<LorebookEntry>;
        delete: (id: string) => Promise<{ success: true }>;
      };
      loreVersions: {
        getByEntry: (entryId: string) => Promise<LorebookEntryVersion[]>;
        create: (entryId: string, content: string) => Promise<LorebookEntryVersion>;
        updateContent: (versionId: string, content: string) => Promise<LorebookEntryVersion>;
        delete: (versionId: string) => Promise<{ success: true }>;
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
