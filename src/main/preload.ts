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

  dbLocation: {
    get: () => ipcRenderer.invoke('dbLocation:get'),
    browseExisting: () => ipcRenderer.invoke('dbLocation:browseExisting'),
    browseNew: () => ipcRenderer.invoke('dbLocation:browseNew'),
    set: (newPath: string) => ipcRenderer.invoke('dbLocation:set', newPath),
    resetToDefault: () => ipcRenderer.invoke('dbLocation:resetToDefault'),
  },

  chat: {
    previewSystemPrompt: (
      characterId: string,
      options?: { personaId?: string; directions?: string; memories?: string[] }
    ) => ipcRenderer.invoke('chat:previewSystemPrompt', characterId, options),
    send: (request: unknown) => ipcRenderer.invoke('chat:send', request),
    regenerate: (request: unknown) => ipcRenderer.invoke('chat:regenerate', request),
    continue: (request: unknown) => ipcRenderer.invoke('chat:continue', request),
    getVariants: (messageId: string) => ipcRenderer.invoke('chat:getVariants', messageId),
    getMessageDebug: (messageId: string) => ipcRenderer.invoke('chat:getMessageDebug', messageId),
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
  },

  loreEntries: {
    getByBook: (lorebookId: string) => ipcRenderer.invoke('loreEntries:getByBook', lorebookId),
    create: (input: unknown) => ipcRenderer.invoke('loreEntries:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('loreEntries:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('loreEntries:delete', id),
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
    setImageMode: (id: string, input: unknown) => ipcRenderer.invoke('conversations:setImageMode', id, input),
    delete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  },

  ollama: {
    listModels: () => ipcRenderer.invoke('ollama:listModels'),
    listModelsDetailed: () => ipcRenderer.invoke('ollama:listModelsDetailed'),
  },

  modelTuning: {
    getGlobalDefaults: () => ipcRenderer.invoke('modelTuning:getGlobalDefaults'),
    getAll: () => ipcRenderer.invoke('modelTuning:getAll'),
    getEffective: (model: string) => ipcRenderer.invoke('modelTuning:getEffective', model),
    getRecommended: (model: string) => ipcRenderer.invoke('modelTuning:getRecommended', model),
    update: (model: string, partial: unknown) => ipcRenderer.invoke('modelTuning:update', model, partial),
    resetField: (model: string, field: string) => ipcRenderer.invoke('modelTuning:resetField', model, field),
    resetAll: (model: string) => ipcRenderer.invoke('modelTuning:resetAll', model),
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
