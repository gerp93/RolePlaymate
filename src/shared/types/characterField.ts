export type FieldType = 'personality' | 'scenario' | 'greeting' | 'dialogue';

export const FIELD_TYPES: FieldType[] = ['personality', 'scenario', 'greeting', 'dialogue'];

export const FIELD_LABELS: Record<FieldType, string> = {
  personality: 'Personality',
  scenario: 'Scenario',
  greeting: 'Opening Greeting',
  dialogue: 'Example Dialogue',
};

/** A content record -- the actual versioned text for one aspect of a character
 * (personality / scenario / greeting). Mirrors TrackDraft's Part/PartVersion split:
 * this row is just an identity + type, the text itself lives in CharacterFieldVersion. */
export interface CharacterField {
  id: string;
  characterId: string;
  fieldType: FieldType;
  createdAt: string;
  updatedAt: string;
}
