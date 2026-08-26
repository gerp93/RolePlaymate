/** One portrait image belonging to a character. A character can have zero or more,
 * ordered by `position` -- position 0 is the cover shown on the character list tile. */
export interface CharacterImage {
  id: string;
  characterId: string;
  path: string;
  position: number;
  createdAt: string;
}
