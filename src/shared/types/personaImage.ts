/** One portrait image belonging to a persona. A persona can have zero or more, ordered by
 * `position` -- position 0 is the cover shown on the persona list tile. Mirrors
 * CharacterImage/character_images exactly. */
export interface PersonaImage {
  id: string;
  personaId: string;
  path: string;
  position: number;
  createdAt: string;
}
