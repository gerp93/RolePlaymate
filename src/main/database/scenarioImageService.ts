import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { ScenarioImage } from '../../shared/types/scenario';
import { transaction } from './schema';

function rowToImage(row: Record<string, unknown>): ScenarioImage {
  return {
    id: row.id as string,
    scenarioId: row.scenarioId as string,
    path: row.path as string,
    position: row.position as number,
    createdAt: row.createdAt as string,
  };
}

const SELECT_COLUMNS = `
  id,
  scenario_id as scenarioId,
  path,
  position,
  created_at as createdAt
`;

/** A scenario's own image gallery -- direct mirror of CharacterImageService. */
export class ScenarioImageService {
  constructor(private db: DatabaseSync) {}

  getImagesByScenario(scenarioId: string): ScenarioImage[] {
    const rows = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM scenario_images WHERE scenario_id = ? ORDER BY position`)
      .all(scenarioId);
    return rows.map(rowToImage);
  }

  getImageById(id: string): ScenarioImage | null {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM scenario_images WHERE id = ?`).get(id);
    return row ? rowToImage(row) : null;
  }

  addImage(scenarioId: string, path: string): ScenarioImage {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      const existing = this.getImagesByScenario(scenarioId);
      const nextPosition = existing.length === 0 ? 0 : Math.max(...existing.map((i) => i.position)) + 1;

      this.db
        .prepare(
          `INSERT INTO scenario_images (id, scenario_id, path, position, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, scenarioId, path, nextPosition, now);

      return this.getImageById(id)!;
    });
  }

  removeImage(id: string): void {
    this.db.prepare(`DELETE FROM scenario_images WHERE id = ?`).run(id);
  }

  /** Same swap-with-position-0 convention as CharacterImageService.setCoverImage. */
  setCoverImage(imageId: string): void {
    const target = this.getImageById(imageId);
    if (!target) throw new Error(`Image ${imageId} not found`);
    if (target.position === 0) return;

    transaction(this.db, () => {
      const current = this.db
        .prepare(`SELECT id FROM scenario_images WHERE scenario_id = ? AND position = 0`)
        .get(target.scenarioId) as { id: string } | undefined;

      if (current) {
        this.db.prepare(`UPDATE scenario_images SET position = ? WHERE id = ?`).run(target.position, current.id);
      }
      this.db.prepare(`UPDATE scenario_images SET position = 0 WHERE id = ?`).run(imageId);
    });
  }
}
