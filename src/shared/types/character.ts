export interface Character {
  id: string;
  name: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterInput {
  name: string;
}

export interface UpdateCharacterInput {
  name?: string;
  imageUrl?: string | null;
}
