import { contextBridge, ipcRenderer } from 'electron';
import { CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';

contextBridge.exposeInMainWorld('electronAPI', {
  characters: {
    getAll: () => ipcRenderer.invoke('characters:getAll'),
    getById: (id: string) => ipcRenderer.invoke('characters:getById', id),
    create: (input: CreateCharacterInput) => ipcRenderer.invoke('characters:create', input),
    update: (id: string, input: UpdateCharacterInput) => ipcRenderer.invoke('characters:update', id, input),
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
  },

  dbLocation: {
    get: () => ipcRenderer.invoke('dbLocation:get'),
    browseExisting: () => ipcRenderer.invoke('dbLocation:browseExisting'),
    browseNew: () => ipcRenderer.invoke('dbLocation:browseNew'),
    set: (newPath: string) => ipcRenderer.invoke('dbLocation:set', newPath),
    resetToDefault: () => ipcRenderer.invoke('dbLocation:resetToDefault'),
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
  },
});
