import { Character, CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';
import { CharacterField } from '../shared/types/characterField';
import { CharacterFieldVersion } from '../shared/types/fieldVersion';
import { CharacterImage } from '../shared/types/characterImage';
import { OllamaModelInfo } from '../shared/types/ollama';
import { PersonaImage } from '../shared/types/personaImage';
import {
  BuiltPrompt,
  ChatStreamEvent,
  ChatSendRequest,
  ChatRegenerateRequest,
  ChatEditPriorMessageRequest,
  ChatDebugInfo,
  SamplerParams,
  ModelSamplerDefaults,
} from '../shared/types/chat';
import {
  UserPersona,
  CreateUserPersonaInput,
  UpdateUserPersonaInput,
  PersonaBackgroundVersion,
} from '../shared/types/userPersona';
import { Conversation, ConversationListItem, CreateConversationInput, ImageMode } from '../shared/types/conversation';
import {
  Scenario,
  ScenarioVersion,
  ScenarioImage,
  CreateScenarioInput,
  UpdateScenarioInput,
} from '../shared/types/scenario';
import { Message, MessageVariant } from '../shared/types/message';
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
import { PromptTemplates, StopPhraseSettings, PromptFieldVersion } from '../shared/types/promptTemplates';

declare global {
  interface Window {
    electronAPI: {
      characters: {
        getAll: () => Promise<Character[]>;
        getById: (id: string) => Promise<Character | null>;
        create: (input: CreateCharacterInput) => Promise<Character>;
        update: (id: string, input: UpdateCharacterInput) => Promise<Character>;
        setHidden: (id: string, hidden: boolean) => Promise<Character>;
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
        add: (characterId: string) => Promise<CharacterImage[]>;
        remove: (id: string) => Promise<{ success: boolean }>;
        setCover: (id: string) => Promise<{ success: boolean }>;
      };
      personaImages: {
        getByPersona: (personaId: string) => Promise<PersonaImage[]>;
        getAllGroupedByPersona: () => Promise<Record<string, PersonaImage[]>>;
        add: (personaId: string) => Promise<PersonaImage[]>;
        remove: (id: string) => Promise<{ success: boolean }>;
        setCover: (id: string) => Promise<{ success: boolean }>;
      };
      scenarios: {
        getByCharacter: (characterId: string) => Promise<Scenario[]>;
        getById: (id: string) => Promise<Scenario | null>;
        create: (input: CreateScenarioInput) => Promise<Scenario>;
        update: (id: string, input: UpdateScenarioInput) => Promise<Scenario>;
        setHidden: (id: string, hidden: boolean) => Promise<Scenario>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      scenarioVersions: {
        getByScenario: (scenarioId: string) => Promise<ScenarioVersion[]>;
        create: (scenarioId: string, content: string) => Promise<ScenarioVersion>;
        updateContent: (id: string, content: string) => Promise<ScenarioVersion>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      scenarioGreetingVersions: {
        getByScenario: (scenarioId: string) => Promise<ScenarioVersion[]>;
        create: (scenarioId: string, content: string) => Promise<ScenarioVersion>;
        updateContent: (id: string, content: string) => Promise<ScenarioVersion>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };
      scenarioImages: {
        getByScenario: (scenarioId: string) => Promise<ScenarioImage[]>;
        add: (scenarioId: string) => Promise<ScenarioImage[]>;
        remove: (id: string) => Promise<{ success: boolean }>;
        setCover: (id: string) => Promise<{ success: boolean }>;
      };
      dbLocation: {
        get: () => Promise<{ path: string; isDefault: boolean; defaultPath: string }>;
        browseExisting: () => Promise<string | null>;
        browseNew: () => Promise<string | null>;
        set: (newPath: string) => Promise<{ success: boolean }>;
        resetToDefault: () => Promise<{ success: boolean }>;
      };
      ollamaHost: {
        get: () => Promise<{ host: string; isDefault: boolean; defaultHost: string }>;
        set: (host: string) => Promise<{ success: boolean }>;
        resetToDefault: () => Promise<{ success: boolean }>;
      };
      chat: {
        previewSystemPrompt: (
          characterId: string,
          options?: { personaId?: string; scenarioId?: string; directions?: string; memories?: string[] }
        ) => Promise<BuiltPrompt>;
        send: (
          request: ChatSendRequest & { characterId: string; personaId?: string; model: string }
        ) => Promise<{ streamId: string }>;
        regenerate: (request: ChatRegenerateRequest) => Promise<{ streamId: string }>;
        editPriorMessage: (
          request: ChatEditPriorMessageRequest & { characterId: string; personaId?: string; model: string }
        ) => Promise<{ streamId: string }>;
        continue: (request: {
          conversationId: string;
          characterId: string;
          personaId?: string;
          model: string;
          directions?: string;
          samplers?: Partial<SamplerParams>;
        }) => Promise<{ streamId: string }>;
        getVariants: (messageId: string) => Promise<MessageVariant[]>;
        getMessageDebug: (messageId: string) => Promise<ChatDebugInfo | null>;
        suggestReply: (request: {
          conversationId: string;
          characterId: string;
          personaId?: string;
          model: string;
        }) => Promise<{ suggestion: string }>;
        selectVariant: (
          conversationId: string,
          messageId: string,
          variantId: string
        ) => Promise<Message>;
        editMessage: (conversationId: string, messageId: string, content: string) => Promise<Message>;
        deleteMessage: (conversationId: string, messageId: string) => Promise<{ success: boolean }>;
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
        setHidden: (id: string, hidden: boolean) => Promise<Lorebook>;
        delete: (id: string) => Promise<{ success: true }>;
        chooseImage: () => Promise<string | null>;
        importFromHtml: () => Promise<{ lorebook: Lorebook; warnings: string[] } | null>;
        /** Creates a brand-new world book from a hand-authored JSON file -- see
         * shared/lorebookImportSample.ts for the shape. */
        importFromJson: () => Promise<{ lorebook: Lorebook; warnings: string[] } | null>;
        clone: (id: string) => Promise<Lorebook>;
        /** Creates the book on first request rather than alongside every character. */
        getPersonalBook: (characterId: string) => Promise<Lorebook>;
        /** Same, for a persona's own private history. */
        getPersonalBookForPersona: (personaId: string) => Promise<Lorebook>;
        getForCharacter: (
          characterId: string
        ) => Promise<{ world: Lorebook[]; personal: Lorebook | null }>;
        attach: (characterId: string, lorebookId: string) => Promise<{ success: true }>;
        detach: (characterId: string, lorebookId: string) => Promise<{ success: true }>;
        /** Same, for a persona's own attached world books (only used by "Suggest reply"). */
        getForPersona: (personaId: string) => Promise<{ world: Lorebook[]; personal: Lorebook | null }>;
        attachToPersona: (personaId: string, lorebookId: string) => Promise<{ success: true }>;
        detachFromPersona: (personaId: string, lorebookId: string) => Promise<{ success: true }>;
      };
      loreEntries: {
        getByBook: (lorebookId: string) => Promise<LorebookEntry[]>;
        create: (input: CreateLorebookEntryInput) => Promise<LorebookEntry>;
        update: (id: string, input: UpdateLorebookEntryInput) => Promise<LorebookEntry>;
        delete: (id: string) => Promise<{ success: true }>;
        /** Bulk-adds entries to an already-existing book from a hand-authored JSON file. */
        importFromJson: (lorebookId: string) => Promise<{ count: number; warnings: string[] } | null>;
      };
      loreVersions: {
        getByEntry: (entryId: string) => Promise<LorebookEntryVersion[]>;
        create: (entryId: string, content: string) => Promise<LorebookEntryVersion>;
        updateContent: (versionId: string, content: string) => Promise<LorebookEntryVersion>;
        delete: (versionId: string) => Promise<{ success: true }>;
      };
      conversations: {
        getAll: () => Promise<ConversationListItem[]>;
        getById: (id: string) => Promise<Conversation | null>;
        getMessages: (id: string) => Promise<Message[]>;
        create: (input: CreateConversationInput) => Promise<Conversation>;
        rename: (id: string, title: string) => Promise<Conversation>;
        setPersona: (id: string, userPersonaId: string | null) => Promise<Conversation>;
        setScenario: (id: string, scenarioId: string | null) => Promise<Conversation>;
        setImageMode: (
          id: string,
          input: {
            characterImageMode?: ImageMode;
            characterImageId?: string | null;
            scenarioImageId?: string | null;
            personaImageMode?: ImageMode;
            personaImageId?: string | null;
          }
        ) => Promise<Conversation>;
        delete: (id: string) => Promise<{ success: true }>;
        deleteDraft: (id: string) => Promise<{ deleted: boolean }>;
        purgeDrafts: (exceptId?: string) => Promise<{ deletedIds: string[] }>;
      };
      ollama: {
        listModels: () => Promise<
          { available: true; models: string[] } | { available: false; models: string[]; message: string }
        >;
        listModelsDetailed: () => Promise<
          | { available: true; models: OllamaModelInfo[] }
          | { available: false; models: OllamaModelInfo[]; message: string }
        >;
      };
      modelTuning: {
        getGlobalDefaults: () => Promise<SamplerParams>;
        getAll: () => Promise<ModelSamplerDefaults[]>;
        getEffective: (model: string) => Promise<SamplerParams>;
        getRecommended: (model: string) => Promise<SamplerParams>;
        update: (model: string, partial: Partial<SamplerParams>) => Promise<ModelSamplerDefaults>;
        resetField: (model: string, field: keyof SamplerParams) => Promise<{ success: boolean }>;
        resetAll: (model: string) => Promise<{ success: boolean }>;
        setEnabled: (model: string, enabled: boolean) => Promise<ModelSamplerDefaults>;
      };
      personas: {
        getAll: () => Promise<UserPersona[]>;
        create: (input: CreateUserPersonaInput) => Promise<UserPersona>;
        update: (id: string, input: UpdateUserPersonaInput) => Promise<UserPersona>;
        setHidden: (id: string, hidden: boolean) => Promise<UserPersona>;
        delete: (id: string) => Promise<{ success: true }>;
        clone: (id: string) => Promise<UserPersona>;
      };
      personaFieldVersions: {
        getByPersona: (personaId: string) => Promise<PersonaBackgroundVersion[]>;
        getById: (id: string) => Promise<PersonaBackgroundVersion | null>;
        duplicate: (versionId: string) => Promise<PersonaBackgroundVersion>;
        updateContent: (id: string, content: string) => Promise<PersonaBackgroundVersion>;
        delete: (id: string) => Promise<{ success: boolean }>;
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
      security: {
        unlock: (pin: string) => Promise<boolean>;
        lock: () => Promise<{ success: boolean }>;
        setPin: (currentPin: string, newPin: string) => Promise<{ ok: boolean; error?: string }>;
      };
      promptSettings: {
        get: () => Promise<{
          stopPhrases: StopPhraseSettings;
          overriddenFields: string[];
        }>;
        updateStopPhrases: (partial: Partial<StopPhraseSettings>) => Promise<{ success: boolean }>;
        resetField: (
          field: 'stopPhrasesBase' | 'useCharacterNameAsStop' | 'usePersonaNameAsStop'
        ) => Promise<{ success: boolean }>;
        resetAll: () => Promise<{ success: boolean }>;
      };
      promptFieldVersions: {
        getByField: (fieldKey: keyof PromptTemplates) => Promise<PromptFieldVersion[]>;
        getById: (id: string) => Promise<PromptFieldVersion | null>;
        duplicate: (versionId: string) => Promise<PromptFieldVersion>;
        updateContent: (id: string, content: string) => Promise<PromptFieldVersion>;
        delete: (id: string) => Promise<{ success: boolean }>;
        resetToDefault: (fieldKey: keyof PromptTemplates) => Promise<PromptFieldVersion>;
      };
    };
  }
}

export {};
