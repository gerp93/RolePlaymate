export type FieldType = 'personality' | 'dialogue';

export const FIELD_TYPES: FieldType[] = ['personality', 'dialogue'];

export const FIELD_LABELS: Record<FieldType, string> = {
  personality: 'Personality',
  dialogue: 'Example Dialogue',
};

/** A content record -- the actual versioned text for one aspect of a character (personality /
 * dialogue). "Scenario" and "greeting" used to be fixed fields here too but are now
 * scenario-specific -- see shared/types/scenario.ts and scenarioService.ts: a scenario's own
 * text and its own opening greeting, since what a character opens with legitimately differs by
 * situation the same way its scenario description does. Mirrors TrackDraft's Part/PartVersion
 * split: this row is just an identity + type, the text itself lives in CharacterFieldVersion. */
export interface CharacterField {
  id: string;
  characterId: string;
  fieldType: FieldType;
  createdAt: string;
  updatedAt: string;
}
