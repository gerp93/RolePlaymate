import type { DatabaseSync } from './sqlite';
import { v4 as uuidv4 } from 'uuid';
import { Scenario, ScenarioVersion, UpdateScenarioInput } from '../../shared/types/scenario';
import { transaction } from './schema';
import { SecurityService } from './securityService';

function rowToScenarioRaw(row: Record<string, unknown>): Scenario {
  return {
    id: row.id as string,
    characterId: row.characterId as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    isHidden: !!row.isHidden,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

const SCENARIO_COLUMNS = `
  id,
  character_id as characterId,
  name,
  description,
  is_hidden as isHidden,
  created_at as createdAt,
  updated_at as updatedAt
`;

function rowToVersion(row: Record<string, unknown>): ScenarioVersion {
  return {
    id: row.id as string,
    scenarioId: row.scenarioId as string,
    versionNumber: row.versionNumber as number,
    content: row.content as string,
    isActive: !!row.isActive,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

const VERSION_COLUMNS = `
  id,
  scenario_id as scenarioId,
  version_number as versionNumber,
  content,
  is_active as isActive,
  created_at as createdAt,
  updated_at as updatedAt
`;

/** The two versioned texts a scenario carries -- its own description and its own opening
 * greeting, each in its own table but otherwise identical in shape and rules. Table names are
 * two fixed literals here, never user input, so interpolating them directly into SQL is safe. */
type VersionTable = 'scenario_versions' | 'scenario_greeting_versions';

/**
 * A character's 1-to-N Scenarios -- see shared/types/scenario.ts. Bundles the scenario row and
 * its two versioned texts (content, greeting) in one service, same convention LorebookService
 * already uses for books+entries+versions, rather than the separate Character/FieldVersion
 * service split.
 */
export class ScenarioService {
  constructor(private db: DatabaseSync, private security: SecurityService) {}

  private rowToScenario(row: Record<string, unknown>): Scenario {
    return rowToScenarioRaw(row);
  }

  getScenariosByCharacter(characterId: string): Scenario[] {
    const rows = this.db
      .prepare(`SELECT ${SCENARIO_COLUMNS} FROM scenarios WHERE character_id = ? ORDER BY created_at`)
      .all(characterId);
    return rows.map((r) => this.rowToScenario(r));
  }

  getScenario(id: string): Scenario | null {
    const row = this.db.prepare(`SELECT ${SCENARIO_COLUMNS} FROM scenarios WHERE id = ?`).get(id);
    return row ? this.rowToScenario(row) : null;
  }

  /** New scenarios are never created hidden, so nothing here ever needs to encrypt. Seeds one
   * blank, active version in both tables -- same as createEntry seeding a lorebook entry -- so
   * a scenario never has zero versions of either to show. */
  createScenario(characterId: string, name: string, description?: string | null): Scenario {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO scenarios (id, character_id, name, description, is_hidden, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`
        )
        .run(id, characterId, name, description ?? null, now, now);

      for (const table of ['scenario_versions', 'scenario_greeting_versions'] as const) {
        this.db
          .prepare(
            `INSERT INTO ${table} (id, scenario_id, version_number, content, is_active, created_at, updated_at)
             VALUES (?, ?, 1, '', 1, ?, ?)`
          )
          .run(uuidv4(), id, now, now);
      }

      return this.getScenario(id)!;
    });
  }

  updateScenario(id: string, input: UpdateScenarioInput): Scenario {
    const existing = this.getScenario(id);
    if (!existing) throw new Error(`Scenario with id ${id} not found`);

    const name = input.name !== undefined ? input.name : existing.name;
    const description = input.description !== undefined ? input.description || null : existing.description;

    this.db
      .prepare(`UPDATE scenarios SET name = ?, description = ?, updated_at = ? WHERE id = ?`)
      .run(
        name,
        description,
        new Date().toISOString(),
        id
      );
    return this.getScenario(id)!;
  }

  /** Cascades to scenario_versions, scenario_greeting_versions, and scenario_images via ON
   * DELETE CASCADE. Callers that care about image files fetch the paths first and unlink them
   * (see the scenarios:delete IPC handler, same pattern as characters:delete). */
  deleteScenario(id: string): void {
    this.db.prepare(`DELETE FROM scenarios WHERE id = ?`).run(id);
  }

  /**
   * Same as CharacterService.setHidden: a privacy-screen flag flip that still requires the PIN
   * to have been entered. Versions of both tables are untouched -- hiding never rewrites content.
   */
  setHidden(id: string, hidden: boolean): Scenario {
    const existing = this.getScenario(id);
    if (!existing) throw new Error(`Scenario with id ${id} not found`);
    if (!this.security.isUnlocked()) {
      throw new Error('Unlock with the PIN before hiding or unhiding an item');
    }

    this.db
      .prepare(`UPDATE scenarios SET is_hidden = ?, updated_at = ? WHERE id = ?`)
      .run(hidden ? 1 : 0, new Date().toISOString(), id);
    return this.getScenario(id)!;
  }

  // --- Versions (shared engine for content + greeting) ----------------------------------

  /**
   * NOTE: active always tracks the latest version, same rule as character fields and lorebook
   * entries -- there is deliberately no "activate an older version" operation.
   */
  private getVersionsFromTable(table: VersionTable, scenarioId: string): ScenarioVersion[] {
    const versions = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM ${table} WHERE scenario_id = ? ORDER BY version_number`)
      .all(scenarioId)
      .map(rowToVersion);
    return this.ensureLatestIsActive(table, scenarioId, versions);
  }

  private ensureLatestIsActive(
    table: VersionTable,
    scenarioId: string,
    versions: ScenarioVersion[]
  ): ScenarioVersion[] {
    if (versions.length === 0) return versions;
    const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
    if (latest.isActive) return versions;

    const now = new Date().toISOString();
    transaction(this.db, () => {
      this.db
        .prepare(`UPDATE ${table} SET is_active = 0, updated_at = ? WHERE scenario_id = ? AND is_active = 1`)
        .run(now, scenarioId);
      this.db.prepare(`UPDATE ${table} SET is_active = 1, updated_at = ? WHERE id = ?`).run(now, latest.id);
    });

    return versions.map((v) => ({ ...v, isActive: v.id === latest.id }));
  }

  private createVersionInTable(table: VersionTable, scenarioId: string, content: string): ScenarioVersion {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      const existing = this.getVersionsFromTable(table, scenarioId);
      const nextVersionNumber = Math.max(...existing.map((v) => v.versionNumber)) + 1;

      this.db
        .prepare(`UPDATE ${table} SET is_active = 0, updated_at = ? WHERE scenario_id = ? AND is_active = 1`)
        .run(now, scenarioId);
      this.db
        .prepare(
          `INSERT INTO ${table} (id, scenario_id, version_number, content, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, scenarioId, nextVersionNumber, content, now, now);

      const row = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM ${table} WHERE id = ?`).get(id)!;
      return rowToVersion(row);
    });
  }

  private updateVersionContentInTable(table: VersionTable, versionId: string, content: string): ScenarioVersion {
    const row = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM ${table} WHERE id = ?`).get(versionId);
    if (!row) throw new Error(`Version with id ${versionId} not found`);

    this.db
      .prepare(`UPDATE ${table} SET content = ?, updated_at = ? WHERE id = ?`)
      .run(content, new Date().toISOString(), versionId);

    const updated = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM ${table} WHERE id = ?`).get(versionId)!;
    return rowToVersion(updated);
  }

  /** Blocked on the last remaining version, same as character fields and lorebook entries. */
  private deleteVersionFromTable(table: VersionTable, versionId: string): void {
    const row = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM ${table} WHERE id = ?`).get(versionId);
    if (!row) return;
    const version = rowToVersion(row);

    const siblings = this.getVersionsFromTable(table, version.scenarioId);
    if (siblings.length <= 1) {
      throw new Error("Cannot delete a scenario's only version");
    }

    transaction(this.db, () => {
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(versionId);
      if (version.isActive) {
        const remaining = siblings.filter((v) => v.id !== versionId);
        const mostRecent = remaining.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
        this.db
          .prepare(`UPDATE ${table} SET is_active = 1, updated_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), mostRecent.id);
      }
    });
  }

  // --- Scenario text (content) -----------------------------------------------------------

  getVersions(scenarioId: string): ScenarioVersion[] {
    return this.getVersionsFromTable('scenario_versions', scenarioId);
  }

  getActiveContent(scenarioId: string): string {
    return this.getVersions(scenarioId).find((v) => v.isActive)?.content ?? '';
  }

  createVersion(scenarioId: string, content: string): ScenarioVersion {
    return this.createVersionInTable('scenario_versions', scenarioId, content);
  }

  updateVersionContent(versionId: string, content: string): ScenarioVersion {
    return this.updateVersionContentInTable('scenario_versions', versionId, content);
  }

  deleteVersion(versionId: string): void {
    this.deleteVersionFromTable('scenario_versions', versionId);
  }

  // --- Scenario greeting -------------------------------------------------------------------

  getGreetingVersions(scenarioId: string): ScenarioVersion[] {
    return this.getVersionsFromTable('scenario_greeting_versions', scenarioId);
  }

  getActiveGreeting(scenarioId: string): string {
    return this.getGreetingVersions(scenarioId).find((v) => v.isActive)?.content ?? '';
  }

  createGreetingVersion(scenarioId: string, content: string): ScenarioVersion {
    return this.createVersionInTable('scenario_greeting_versions', scenarioId, content);
  }

  updateGreetingVersionContent(versionId: string, content: string): ScenarioVersion {
    return this.updateVersionContentInTable('scenario_greeting_versions', versionId, content);
  }

  deleteGreetingVersion(versionId: string): void {
    this.deleteVersionFromTable('scenario_greeting_versions', versionId);
  }
}
