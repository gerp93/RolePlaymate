export interface Character {
  id: string;
  name: string;
  description: string | null;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterInput {
  name: string;
  description?: string;
}

export interface UpdateCharacterInput {
  name?: string;
  description?: string;
}
