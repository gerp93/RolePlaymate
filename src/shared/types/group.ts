/** A deliberate ensemble of characters that chat together -- a peer of Character, not a
 * conversation setting. Owns its own Scenarios (see shared/types/scenario.ts) and a block of
 * plain-text `instructions` injected into every member's prompt. The roster is live: editing it
 * changes every conversation started from the group, and past messages keep their speaker. */
export interface Group {
  id: string;
  name: string;
  /** Short library/picker blurb only -- never injected into a prompt. */
  description: string | null;
  /** Injected into each member's system prompt (see PromptBuilder's group context block). */
  instructions: string | null;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One roster slot, in display order. `position` 0 is who speaks a scenario's greeting. */
export interface GroupMember {
  characterId: string;
  position: number;
}

/** A group with its roster resolved, for lists and pickers. */
export interface GroupWithMembers extends Group {
  members: GroupMember[];
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  instructions?: string;
  /** Initial roster, in order. Must satisfy MIN_GROUP_CHARACTERS/MAX_GROUP_CHARACTERS. */
  characterIds: string[];
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  instructions?: string;
}

/** A group needs at least two characters to be a group; the cap keeps the prompt (which carries
 * every member's card across turns) from growing past what a local model handles well. */
export const MIN_GROUP_CHARACTERS = 2;
export const MAX_GROUP_CHARACTERS = 4;
