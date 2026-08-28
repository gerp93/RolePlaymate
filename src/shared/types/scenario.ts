/** One of a character's settings/situations -- split out from the old fixed, single-slot
 * "scenario" CharacterField so a character's permanent traits (personality/dialogue) don't have
 * to be duplicated onto a new character just to reuse them in a different setting. Owned
 * outright by one character (1-to-N, not shared like world lorebooks); a conversation picks at
 * most one. Independently hideable from its owning character -- see ScenarioVersion for why
 * the actual text lives there instead of here. */
export interface Scenario {
  id: string;
  characterId: string;
  name: string;
  /** Short picker/library blurb only -- never injected into the system prompt. */
  description: string | null;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScenarioInput {
  characterId: string;
  name: string;
  description?: string;
}

export interface UpdateScenarioInput {
  name?: string;
  description?: string;
}

/** Same versioning model as CharacterFieldVersion/LorebookEntryVersion -- active always tracks
 * the latest version, self-healed on read. */
export interface ScenarioVersion {
  id: string;
  scenarioId: string;
  versionNumber: number;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One image belonging to a scenario. Same shape/conventions as CharacterImage: zero or more,
 * ordered by `position`, position 0 is the cover -- the image that becomes the default shown
 * for a chat where this scenario is selected (see conversationService.setConversationScenario). */
export interface ScenarioImage {
  id: string;
  scenarioId: string;
  path: string;
  position: number;
  createdAt: string;
}
