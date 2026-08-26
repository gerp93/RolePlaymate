export interface Character {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterInput {
  name: string;
}

export interface UpdateCharacterInput {
  name?: string;
}
