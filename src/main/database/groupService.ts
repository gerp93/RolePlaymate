import type { DatabaseSync } from './sqlite';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateGroupInput,
  Group,
  GroupMember,
  GroupWithMembers,
  MAX_GROUP_CHARACTERS,
  MIN_GROUP_CHARACTERS,
  UpdateGroupInput,
} from '../../shared/types/group';
import { transaction } from './schema';
import { SecurityService } from './securityService';

const GROUP_COLUMNS = `
  id,
  name,
  description,
  instructions,
  is_hidden as isHidden,
  created_at as createdAt,
  updated_at as updatedAt
`;

function rowToGroup(row: Record<string, unknown>): Group {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    instructions: (row.instructions as string | null) ?? null,
    isHidden: !!row.isHidden,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

function assertRosterSize(count: number): void {
  if (count < MIN_GROUP_CHARACTERS) {
    throw new Error(`A group needs at least ${MIN_GROUP_CHARACTERS} characters`);
  }
  if (count > MAX_GROUP_CHARACTERS) {
    throw new Error(`A group can have at most ${MAX_GROUP_CHARACTERS} characters`);
  }
}

/**
 * Groups: named ensembles of characters, a peer of CharacterService. The roster is a live
 * many-to-many (`character_group_members`), so editing it changes every conversation started
 * from the group -- see shared/types/group.ts. Scenarios owned by a group live in
 * ScenarioService, not here.
 */
export class GroupService {
  constructor(private db: DatabaseSync, private security: SecurityService) {}

  getAllGroups(): GroupWithMembers[] {
    const rows = this.db.prepare(`SELECT ${GROUP_COLUMNS} FROM character_groups ORDER BY updated_at DESC`).all();
    return rows.map((r) => this.withMembers(rowToGroup(r)));
  }

  getGroupById(id: string): GroupWithMembers | null {
    const row = this.db.prepare(`SELECT ${GROUP_COLUMNS} FROM character_groups WHERE id = ?`).get(id);
    return row ? this.withMembers(rowToGroup(row)) : null;
  }

  getMembers(groupId: string): GroupMember[] {
    return this.db
      .prepare(
        `SELECT character_id as characterId, position FROM character_group_members
         WHERE group_id = ? ORDER BY position`
      )
      .all(groupId)
      .map((r) => ({ characterId: r.characterId as string, position: Number(r.position) }));
  }

  private withMembers(group: Group): GroupWithMembers {
    return { ...group, members: this.getMembers(group.id) };
  }

  /** New groups are never created hidden. Roster order is the order given. */
  createGroup(input: CreateGroupInput): GroupWithMembers {
    const characterIds = [...new Set(input.characterIds)];
    assertRosterSize(characterIds.length);

    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO character_groups (id, name, description, instructions, is_hidden, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`
        )
        .run(id, input.name, input.description ?? null, input.instructions ?? null, now, now);

      const insert = this.db.prepare(
        `INSERT INTO character_group_members (group_id, character_id, position) VALUES (?, ?, ?)`
      );
      characterIds.forEach((characterId, position) => insert.run(id, characterId, position));

      return this.getGroupById(id)!;
    });
  }

  updateGroup(id: string, input: UpdateGroupInput): GroupWithMembers {
    const existing = this.getGroupById(id);
    if (!existing) throw new Error(`Group with id ${id} not found`);

    const name = input.name !== undefined ? input.name : existing.name;
    const description = input.description !== undefined ? input.description || null : existing.description;
    const instructions = input.instructions !== undefined ? input.instructions || null : existing.instructions;

    this.db
      .prepare(`UPDATE character_groups SET name = ?, description = ?, instructions = ?, updated_at = ? WHERE id = ?`)
      .run(name, description, instructions, new Date().toISOString(), id);
    return this.getGroupById(id)!;
  }

  /** Replaces the whole roster (order included) in one step, so the 2-4 bound is checked against
   * the final list rather than tripped by an intermediate add/remove. */
  setMembers(id: string, characterIds: string[]): GroupWithMembers {
    if (!this.getGroupById(id)) throw new Error(`Group with id ${id} not found`);
    const unique = [...new Set(characterIds)];
    assertRosterSize(unique.length);

    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM character_group_members WHERE group_id = ?`).run(id);
      const insert = this.db.prepare(
        `INSERT INTO character_group_members (group_id, character_id, position) VALUES (?, ?, ?)`
      );
      unique.forEach((characterId, position) => insert.run(id, characterId, position));
      this.db.prepare(`UPDATE character_groups SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
    });
    return this.getGroupById(id)!;
  }

  /** Same privacy-screen rule as CharacterService.setHidden: flips the flag only, and still needs
   * the PIN to have been entered. */
  setHidden(id: string, hidden: boolean): GroupWithMembers {
    if (!this.getGroupById(id)) throw new Error(`Group with id ${id} not found`);
    if (!this.security.isUnlocked()) {
      throw new Error('Unlock with the PIN before hiding or unhiding an item');
    }
    this.db
      .prepare(`UPDATE character_groups SET is_hidden = ?, updated_at = ? WHERE id = ?`)
      .run(hidden ? 1 : 0, new Date().toISOString(), id);
    return this.getGroupById(id)!;
  }

  /** Cascades to the roster and to the group's scenarios (and their versions/images) via ON
   * DELETE CASCADE. conversations.group_id is ON DELETE SET NULL like character_id, so, as with
   * characters, delete the group's conversations explicitly first in the same transaction rather
   * than leave orphans; messages and memories cascade from the conversation delete. Callers that
   * care about scenario image files fetch the paths first (see the groups:delete IPC handler). */
  deleteGroup(id: string): void {
    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM conversations WHERE group_id = ?`).run(id);
      this.db.prepare(`DELETE FROM character_groups WHERE id = ?`).run(id);
    });
  }
}
