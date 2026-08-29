import { contextBridge, ipcRenderer } from 'electron';
import { CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';

contextBridge.exposeInMainWorld('electronAPI', {
  characters: {
    getAll: () => ipcRenderer.invoke('characters:getAll'),
    getById: (id: string) => ipcRenderer.invoke('characters:getById', id),
    create: (input: CreateCharacterInput) => ipcRenderer.invoke('characters:create', input),
    update: (id: string, input: UpdateCharacterInput) => ipcRenderer.invoke('characters:update', id, input),
    setHidden: (id: string, hidden: boolean) => ipcRenderer.invoke('characters:setHidden', id, hidden),
    clone: (id: string) => ipcRenderer.invoke('characters:clone', id),
    delete: (id: string) => ipcRenderer.invoke('characters:delete', id),
    importFromHtml: () => ipcRenderer.invoke('characters:importFromHtml'),
  },

  fields: {
    getByCharacter: (characterId: string) => ipcRenderer.invoke('fields:getByCharacter', characterId),
  },

  fieldVersions: {
    getByField: (fieldId: string) => ipcRenderer.invoke('fieldVersions:getByField', fieldId),
    getById: (id: string) => ipcRenderer.invoke('fieldVersions:getById', id),
    duplicate: (versionId: string) => ipcRenderer.invoke('fieldVersions:duplicate', versionId),
    updateContent: (id: string, content: string) => ipcRenderer.invoke('fieldVersions:updateContent', id, content),
    delete: (id: string) => ipcRenderer.invoke('fieldVersions:delete', id),
  },

  characterImages: {
    getByCharacter: (characterId: string) => ipcRenderer.invoke('characterImages:getByCharacter', characterId),
    getAllGroupedByCharacter: () => ipcRenderer.invoke('characterImages:getAllGroupedByCharacter'),
    add: (characterId: string) => ipcRenderer.invoke('characterImages:add', characterId),
    remove: (id: string) => ipcRenderer.invoke('characterImages:remove', id),
    setCover: (id: string) => ipcRenderer.invoke('characterImages:setCover', id),
  },

  personaImages: {
    getByPersona: (personaId: string) => ipcRenderer.invoke('personaImages:getByPersona', personaId),
    getAllGroupedByPersona: () => ipcRenderer.invoke('personaImages:getAllGroupedByPersona'),
    add: (personaId: string) => ipcRenderer.invoke('personaImages:add', personaId),
    remove: (id: string) => ipcRenderer.invoke('personaImages:remove', id),
    setCover: (id: string) => ipcRenderer.invoke('personaImages:setCover', id),
  },

  scenarios: {
    getByCharacter: (characterId: string) => ipcRenderer.invoke('scenarios:getByCharacter', characterId),
    getById: (id: string) => ipcRenderer.invoke('scenarios:getById', id),
    create: (input: { characterId: string; name: string; description?: string }) => ipcRenderer.invoke('scenarios:create', input),
    update: (id: string, input: { name?: string; description?: string }) => ipcRenderer.invoke('scenarios:update', id, input),
    setHidden: (id: string, hidden: boolean) => ipcRenderer.invoke('scenarios:setHidden', id, hidden),
    delete: (id: string) => ipcRenderer.invoke('scenarios:delete', id),
  },

  scenarioVersions: {
    getByScenario: (scenarioId: string) => ipcRenderer.invoke('scenarioVersions:getByScenario', scenarioId),
    create: (scenarioId: string, content: string) =>
      ipcRenderer.invoke('scenarioVersions:create', scenarioId, content),
    updateContent: (id: string, content: string) =>
      ipcRenderer.invoke('scenarioVersions:updateContent', id, content),
    delete: (id: string) => ipcRenderer.invoke('scenarioVersions:delete', id),
  },

  scenarioGreetingVersions: {
    getByScenario: (scenarioId: string) =>
      ipcRenderer.invoke('scenarioGreetingVersions:getByScenario', scenarioId),
    create: (scenarioId: string, content: string) =>
      ipcRenderer.invoke('scenarioGreetingVersions:create', scenarioId, content),
    updateContent: (id: string, content: string) =>
      ipcRenderer.invoke('scenarioGreetingVersions:updateContent', id, content),
    delete: (id: string) => ipcRenderer.invoke('scenarioGreetingVersions:delete', id),
  },

  scenarioImages: {
    getByScenario: (scenarioId: string) => ipcRenderer.invoke('scenarioImages:getByScenario', scenarioId),
    add: (scenarioId: string) => ipcRenderer.invoke('scenarioImages:add', scenarioId),
    remove: (id: string) => ipcRenderer.invoke('scenarioImages:remove', id),
    setCover: (id: string) => ipcRenderer.invoke('scenarioImages:setCover', id),
  },

  dbLocation: {
    get: () => ipcRenderer.invoke('dbLocation:get'),
    browseExisting: () => ipcRenderer.invoke('dbLocation:browseExisting'),
    browseNew: () => ipcRenderer.invoke('dbLocation:browseNew'),
    set: (newPath: string) => ipcRenderer.invoke('dbLocation:set', newPath),
    resetToDefault: () => ipcRenderer.invoke('dbLocation:resetToDefault'),
    showInFolder: () => ipcRenderer.invoke('dbLocation:showInFolder'),
  },

  ollamaHost: {
    get: () => ipcRenderer.invoke('ollamaHost:get'),
    set: (host: string) => ipcRenderer.invoke('ollamaHost:set', host),
    resetToDefault: () => ipcRenderer.invoke('ollamaHost:resetToDefault'),
  },

  embeddingModelPrompt: {
    getSuppressed: () => ipcRenderer.invoke('embeddingModelPrompt:getSuppressed'),
    setSuppressed: (suppressed: boolean) =>
      ipcRenderer.invoke('embeddingModelPrompt:setSuppressed', suppressed),
  },

  memoryEmbeddingModel: {
    get: () => ipcRenderer.invoke('memoryEmbeddingModel:get'),
    set: (model: string) => ipcRenderer.invoke('memoryEmbeddingModel:set', model),
    resetToDefault: () => ipcRenderer.invoke('memoryEmbeddingModel:resetToDefault'),
  },

  chat: {
    previewSystemPrompt: (
      characterId: string,
      options?: { personaId?: string; scenarioId?: string; directions?: string; memories?: string[] }
    ) => ipcRenderer.invoke('chat:previewSystemPrompt', characterId, options),
    send: (request: unknown) => ipcRenderer.invoke('chat:send', request),
    regenerate: (request: unknown) => ipcRenderer.invoke('chat:regenerate', request),
    editPriorMessage: (request: unknown) => ipcRenderer.invoke('chat:editPriorMessage', request),
    continue: (request: unknown) => ipcRenderer.invoke('chat:continue', request),
    getVariants: (messageId: string) => ipcRenderer.invoke('chat:getVariants', messageId),
    getMessageDebug: (messageId: string) => ipcRenderer.invoke('chat:getMessageDebug', messageId),
    getDebugHistory: (conversationId: string) =>
      ipcRenderer.invoke('chat:getDebugHistory', conversationId),
    suggestReply: (request: unknown) => ipcRenderer.invoke('chat:suggestReply', request),
    selectVariant: (conversationId: string, messageId: string, variantId: string) =>
      ipcRenderer.invoke('chat:selectVariant', conversationId, messageId, variantId),
    editMessage: (conversationId: string, messageId: string, content: string) =>
      ipcRenderer.invoke('chat:editMessage', conversationId, messageId, content),
    deleteMessage: (conversationId: string, messageId: string) =>
      ipcRenderer.invoke('chat:deleteMessage', conversationId, messageId),
    cancel: (conversationId: string) => ipcRenderer.invoke('chat:cancel', conversationId),
    isGenerating: (conversationId: string) => ipcRenderer.invoke('chat:isGenerating', conversationId),

    // The only push channel in the bridge. Returns an unsubscribe closure so a React effect
    // can clean up -- without one, every remount leaks a listener and Electron warns at ten.
    // The raw IpcRendererEvent is never forwarded: it carries `sender`, which would hand the
    // renderer a way around context isolation.
    onStream: (callback: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('chat:stream', handler);
      return () => ipcRenderer.removeListener('chat:stream', handler);
    },

    // Fires when post-turn extraction stored new memories. Same unsubscribe contract.
    onMemoriesUpdated: (callback: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('chat:memories-updated', handler);
      return () => ipcRenderer.removeListener('chat:memories-updated', handler);
    },
  },

  memories: {
    getAll: (conversationId: string) => ipcRenderer.invoke('memories:getAll', conversationId),
    count: (conversationId: string) => ipcRenderer.invoke('memories:count', conversationId),
    add: (conversationId: string, content: string) =>
      ipcRenderer.invoke('memories:add', conversationId, content),
    update: (id: string, content: string) => ipcRenderer.invoke('memories:update', id, content),
    setPinned: (id: string, pinned: boolean) => ipcRenderer.invoke('memories:setPinned', id, pinned),
    delete: (id: string) => ipcRenderer.invoke('memories:delete', id),
    deleteAll: (conversationId: string) =>
      ipcRenderer.invoke('memories:deleteAll', conversationId),
  },

  lorebooks: {
    getWorldBooks: () => ipcRenderer.invoke('lorebooks:getWorldBooks'),
    getById: (id: string) => ipcRenderer.invoke('lorebooks:getById', id),
    create: (input: unknown) => ipcRenderer.invoke('lorebooks:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('lorebooks:update', id, input),
    setHidden: (id: string, hidden: boolean) => ipcRenderer.invoke('lorebooks:setHidden', id, hidden),
    delete: (id: string) => ipcRenderer.invoke('lorebooks:delete', id),
    chooseImage: () => ipcRenderer.invoke('lorebooks:chooseImage'),
    importFromHtml: () => ipcRenderer.invoke('lorebooks:importFromHtml'),
    importFromJson: () => ipcRenderer.invoke('lorebooks:importFromJson'),
    clone: (id: string) => ipcRenderer.invoke('lorebooks:clone', id),
    getPersonalBook: (characterId: string) =>
      ipcRenderer.invoke('lorebooks:getPersonalBook', characterId),
    getPersonalBookForPersona: (personaId: string) =>
      ipcRenderer.invoke('lorebooks:getPersonalBookForPersona', personaId),
    getForCharacter: (characterId: string) =>
      ipcRenderer.invoke('lorebooks:getForCharacter', characterId),
    attach: (characterId: string, lorebookId: string) =>
      ipcRenderer.invoke('lorebooks:attach', characterId, lorebookId),
    detach: (characterId: string, lorebookId: string) =>
      ipcRenderer.invoke('lorebooks:detach', characterId, lorebookId),
    getForPersona: (personaId: string) => ipcRenderer.invoke('lorebooks:getForPersona', personaId),
    attachToPersona: (personaId: string, lorebookId: string) =>
      ipcRenderer.invoke('lorebooks:attachToPersona', personaId, lorebookId),
    detachFromPersona: (personaId: string, lorebookId: string) =>
      ipcRenderer.invoke('lorebooks:detachFromPersona', personaId, lorebookId),
  },

  loreEntries: {
    getByBook: (lorebookId: string) => ipcRenderer.invoke('loreEntries:getByBook', lorebookId),
    create: (input: unknown) => ipcRenderer.invoke('loreEntries:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('loreEntries:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('loreEntries:delete', id),
    importFromJson: (lorebookId: string) => ipcRenderer.invoke('loreEntries:importFromJson', lorebookId),
  },

  loreVersions: {
    getByEntry: (entryId: string) => ipcRenderer.invoke('loreVersions:getByEntry', entryId),
    create: (entryId: string, content: string) =>
      ipcRenderer.invoke('loreVersions:create', entryId, content),
    updateContent: (versionId: string, content: string) =>
      ipcRenderer.invoke('loreVersions:updateContent', versionId, content),
    delete: (versionId: string) => ipcRenderer.invoke('loreVersions:delete', versionId),
  },

  conversations: {
    getAll: () => ipcRenderer.invoke('conversations:getAll'),
    getById: (id: string) => ipcRenderer.invoke('conversations:getById', id),
    getMessages: (id: string) => ipcRenderer.invoke('conversations:getMessages', id),
    create: (input: unknown) => ipcRenderer.invoke('conversations:create', input),
    rename: (id: string, title: string) => ipcRenderer.invoke('conversations:rename', id, title),
    setPersona: (id: string, userPersonaId: string | null) =>
      ipcRenderer.invoke('conversations:setPersona', id, userPersonaId),
    setScenario: (id: string, scenarioId: string | null) =>
      ipcRenderer.invoke('conversations:setScenario', id, scenarioId),
    setImageMode: (id: string, input: unknown) => ipcRenderer.invoke('conversations:setImageMode', id, input),
    delete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
    deleteDraft: (id: string) => ipcRenderer.invoke('conversations:deleteDraft', id),
    purgeDrafts: (exceptId?: string) => ipcRenderer.invoke('conversations:purgeDrafts', exceptId),
  },

  ollama: {
    listModels: () => ipcRenderer.invoke('ollama:listModels'),
    listModelsDetailed: () => ipcRenderer.invoke('ollama:listModelsDetailed'),
    getEmbeddingModelStatus: () => ipcRenderer.invoke('ollama:getEmbeddingModelStatus'),
  },

  modelTuning: {
    getGlobalDefaults: () => ipcRenderer.invoke('modelTuning:getGlobalDefaults'),
    getAll: () => ipcRenderer.invoke('modelTuning:getAll'),
    getEffective: (model: string) => ipcRenderer.invoke('modelTuning:getEffective', model),
    getRecommended: (model: string) => ipcRenderer.invoke('modelTuning:getRecommended', model),
    update: (model: string, partial: unknown) => ipcRenderer.invoke('modelTuning:update', model, partial),
    resetField: (model: string, field: string) => ipcRenderer.invoke('modelTuning:resetField', model, field),
    resetAll: (model: string) => ipcRenderer.invoke('modelTuning:resetAll', model),
    setEnabled: (model: string, enabled: boolean) => ipcRenderer.invoke('modelTuning:setEnabled', model, enabled),
  },

  personas: {
    getAll: () => ipcRenderer.invoke('personas:getAll'),
    create: (input: unknown) => ipcRenderer.invoke('personas:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('personas:update', id, input),
    setHidden: (id: string, hidden: boolean) => ipcRenderer.invoke('personas:setHidden', id, hidden),
    delete: (id: string) => ipcRenderer.invoke('personas:delete', id),
    clone: (id: string) => ipcRenderer.invoke('personas:clone', id),
  },

  personaFieldVersions: {
    getByPersona: (personaId: string) => ipcRenderer.invoke('personaFieldVersions:getByPersona', personaId),
    getById: (id: string) => ipcRenderer.invoke('personaFieldVersions:getById', id),
    duplicate: (versionId: string) => ipcRenderer.invoke('personaFieldVersions:duplicate', versionId),
    updateContent: (id: string, content: string) =>
      ipcRenderer.invoke('personaFieldVersions:updateContent', id, content),
    delete: (id: string) => ipcRenderer.invoke('personaFieldVersions:delete', id),
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
  },

  security: {
    unlock: (pin: string) => ipcRenderer.invoke('security:unlock', pin) as Promise<boolean>,
    lock: () => ipcRenderer.invoke('security:lock'),
    setPin: (currentPin: string, newPin: string) =>
      ipcRenderer.invoke('security:setPin', currentPin, newPin) as Promise<{ ok: boolean; error?: string }>,
  },

  promptSettings: {
    get: () => ipcRenderer.invoke('promptSettings:get'),
    updateStopPhrases: (partial: unknown) => ipcRenderer.invoke('promptSettings:updateStopPhrases', partial),
    resetField: (field: string) => ipcRenderer.invoke('promptSettings:resetField', field),
    resetAll: () => ipcRenderer.invoke('promptSettings:resetAll'),
  },

  promptFieldVersions: {
    getByField: (fieldKey: string) => ipcRenderer.invoke('promptFieldVersions:getByField', fieldKey),
    getById: (id: string) => ipcRenderer.invoke('promptFieldVersions:getById', id),
    duplicate: (versionId: string) => ipcRenderer.invoke('promptFieldVersions:duplicate', versionId),
    updateContent: (id: string, content: string) => ipcRenderer.invoke('promptFieldVersions:updateContent', id, content),
    delete: (id: string) => ipcRenderer.invoke('promptFieldVersions:delete', id),
    resetToDefault: (fieldKey: string) => ipcRenderer.invoke('promptFieldVersions:resetToDefault', fieldKey),
  },
});
