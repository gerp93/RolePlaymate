export interface CharacterFieldVersion {
  id: string;
  fieldId: string;
  versionNumber: number;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFieldVersionInput {
  fieldId: string;
  content?: string;
}
