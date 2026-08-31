import { Character, CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';
import { CharacterField } from '../shared/types/characterField';
import { CharacterFieldVersion } from '../shared/types/fieldVersion';
import { CharacterImage } from '../shared/types/characterImage';
import { OllamaModelInfo } from '../shared/types/ollama';
import { EmbeddingModelStatus } from '../shared/embeddingModel';
import { PersonaImage } from '../shared/types/personaImage';
import {
  BuiltPrompt,
  ChatStreamEvent,
  ChatSendRequest,
  ChatRegenerateRequest,
  ChatEditPriorMessageRequest,
  ChatDebugInfo,
  ChatDebugHistoryEntry,
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
import { ChatRetentionRule, ChatRetentionState, ChatRetentionRunResult } from '../shared/retention';
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
import {
  CharacterTtsVoice,
  ChatterboxHostInfo,
  ChatterboxStatus,
  TtsSpeakRequest,
  TtsSpeakResult,
  TtsStoreAudioRequest,
  TtsStoreAudioResult,
  TtsAttachAudioRequest,
  TtsImportCloneResult,
  TtsDeleteCloneResult,
  TtsRevealCloneFolderResult,
} from '../shared/types/tts';
import { HardwareSnapshot } from '../shared/types/hardware';

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
        showInFolder: () => Promise<{ success: boolean }>;
      };
      ollamaHost: {
        get: () => Promise<{ host: string; isDefault: boolean; defaultHost: string }>;
        set: (host: string) => Promise<{ success: boolean }>;
        resetToDefault: () => Promise<{ success: boolean }>;
      };
      chatterboxHost: {
        get: () => Promise<ChatterboxHostInfo>;
        set: (host: string) => Promise<{ success: boolean }>;
        resetToDefault: () => Promise<{ success: boolean }>;
      };
      narratorVoice: {
        get: () => Promise<CharacterTtsVoice | null>;
        set: (voice: CharacterTtsVoice | null) => Promise<{ success: boolean }>;
      };
      tts: {
        status: () => Promise<ChatterboxStatus>;
        speak: (request: TtsSpeakRequest) => Promise<TtsSpeakResult>;
        cancel: () => Promise<{ success: boolean }>;
        storeAudio: (request: TtsStoreAudioRequest) => Promise<TtsStoreAudioResult>;
        attachAudio: (request: TtsAttachAudioRequest) => Promise<TtsStoreAudioResult>;
        importClone: (displayName: string) => Promise<TtsImportCloneResult>;
        deleteClone: (filename: string) => Promise<TtsDeleteCloneResult>;
        revealCloneFolder: () => Promise<TtsRevealCloneFolderResult>;
      };
      embeddingModelPrompt: {
        getSuppressed: () => Promise<{ suppressed: boolean }>;
        setSuppressed: (suppressed: boolean) => Promise<{ success: boolean }>;
      };
      memoryEmbeddingModel: {
        get: () => Promise<{ model: string; isDefault: boolean; defaultModel: string }>;
        set: (model: string) => Promise<{ success: true }>;
        resetToDefault: () => Promise<{ success: true }>;
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
        getDebugHistory: (conversationId: string) => Promise<ChatDebugHistoryEntry[]>;
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
        setPinned: (id: string, pinned: boolean) => Promise<ConversationMemory>;
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
        setKeepForever: (id: string, keepForever: boolean) => Promise<Conversation>;
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
      retention: {
        get: () => Promise<ChatRetentionState>;
        setRules: (rules: ChatRetentionRule[]) => Promise<{ rules: ChatRetentionRule[] }>;
        runNow: (ruleId?: string) => Promise<ChatRetentionRunResult>;
        preview: (rules: ChatRetentionRule[]) => Promise<Record<string, number>>;
        setActiveConversation: (id: string | null) => Promise<{ success: true }>;
        onCleaned: (callback: (payload: { deletedIds: string[] }) => void) => () => void;
      };
      ollama: {
        listModels: () => Promise<
          { available: true; models: string[] } | { available: false; models: string[]; message: string }
        >;
        listModelsDetailed: () => Promise<
          | { available: true; models: OllamaModelInfo[] }
          | { available: false; models: OllamaModelInfo[]; message: string }
        >;
        getEmbeddingModelStatus: () => Promise<EmbeddingModelStatus>;
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
      hardware: {
        getSnapshot: () => Promise<HardwareSnapshot>;
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
