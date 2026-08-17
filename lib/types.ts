export type CharacterVersionDTO = {
  id: string;
  characterId: string;
  versionNumber: number;
  name: string;
  personality: string;
  greeting: string;
  scenario: string;
  imageUrl: string | null;
  note: string | null;
  createdAt: string;
};

export type CharacterDTO = {
  id: string;
  name: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  versions: CharacterVersionDTO[];
};

export type CharacterSummaryDTO = {
  id: string;
  name: string;
  imageUrl: string | null;
  updatedAt: string;
  versionCount: number;
  personality: string;
};

export type CharacterFormValues = {
  name: string;
  personality: string;
  greeting: string;
  scenario: string;
  imageUrl: string | null;
};
