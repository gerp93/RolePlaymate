import { Character, CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';
import { CharacterField } from '../shared/types/characterField';
import { CharacterFieldVersion } from '../shared/types/fieldVersion';
import { CharacterImage } from '../shared/types/characterImage';

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
