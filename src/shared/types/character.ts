export interface Character {
  id: string;
  name: string;
  description: string | null;
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
