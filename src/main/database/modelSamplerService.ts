import { DatabaseSync } from 'node:sqlite';
import { ModelSamplerDefaults, SamplerParams } from '../../shared/types/chat';
import { detectModelFamily } from '../../shared/utils/modelFamily';
import { FAMILY_SAMPLER_PRESETS } from '../chat/modelFamilyPresets';

function rowToDefaults(row: Record<string, unknown>): ModelSamplerDefaults {
  return {
    model: row.model as string,
    temperature: row.temperature as number | null,
    maxTokens: row.maxTokens as number | null,
    topP: row.topP as number | null,
    topK: row.topK as number | null,
    repetitionPenalty: row.repetitionPenalty as number | null,
    enabled: (row.enabled as number) !== 0,
    updatedAt: row.updatedAt as string,
  };
}

const SELECT_COLUMNS = `
  model,
  temperature,
  max_tokens as maxTokens,
  top_p as topP,
  top_k as topK,
  repetition_penalty as repetitionPenalty,
  enabled,
  updated_at as updatedAt
`;

/**
 * Per-model sampler defaults -- a lightweight settings store, not versioned or encrypted (a
 * model tag and a few numbers carry nothing sensitive). One row per model that's been given
 * any customization; a model with no row simply uses DEFAULT_SAMPLERS untouched.
 */
export class ModelSamplerService {
  constructor(private db: DatabaseSync) {}

  /** Every model with at least one customized field, for the Model Tuning page's "customized"
   * badge -- the page itself lists every *installed* model (from Ollama) and overlays these. */
  getAll(): ModelSamplerDefaults[] {
    return this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM model_sampler_defaults ORDER BY model`)
      .all()
      .map(rowToDefaults);
  }

  getForModel(model: string): ModelSamplerDefaults | null {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM model_sampler_defaults WHERE model = ?`).get(model);
    return row ? rowToDefaults(row) : null;
  }

  /** `base` (DEFAULT_SAMPLERS) with this model line's recommended preset layered on top --
   * what a field falls back to before any actual saved override, and what the Model Tuning
   * page shows as an unset field's placeholder. Not itself persisted anywhere: recomputed from
   * the hardcoded FAMILY_SAMPLER_PRESETS table every time, same as DEFAULT_SAMPLERS is. */
  getRecommendedDefaults(model: string, base: SamplerParams): SamplerParams {
    const family = detectModelFamily(model);
    const preset = family ? (FAMILY_SAMPLER_PRESETS[family] ?? {}) : {};
    return { ...base, ...preset };
  }

  /** The recommended defaults for this model with any actually-saved override layered on top --
   * the real "effective" value used for generation, before a chat-level (Composer) override. */
  getEffective(model: string, base: SamplerParams): SamplerParams {
    const recommended = this.getRecommendedDefaults(model, base);
    const custom = this.getForModel(model);
    if (!custom) return recommended;
    return {
      temperature: custom.temperature ?? recommended.temperature,
      maxTokens: custom.maxTokens ?? recommended.maxTokens,
      topP: custom.topP ?? recommended.topP,
      topK: custom.topK ?? recommended.topK,
      repetitionPenalty: custom.repetitionPenalty ?? recommended.repetitionPenalty,
    };
  }

  /** Creates or updates one model's row, touching only the fields present in `partial` --
   * fields already set (or already null) for other params are left as they were. */
  upsert(model: string, partial: Partial<SamplerParams>): ModelSamplerDefaults {
    const existing = this.getForModel(model);
    const now = new Date().toISOString();
    const next = {
      temperature: partial.temperature ?? existing?.temperature ?? null,
      maxTokens: partial.maxTokens ?? existing?.maxTokens ?? null,
      topP: partial.topP ?? existing?.topP ?? null,
      topK: partial.topK ?? existing?.topK ?? null,
      repetitionPenalty: partial.repetitionPenalty ?? existing?.repetitionPenalty ?? null,
      enabled: existing?.enabled ?? true,
    };

    this.db
      .prepare(
        `INSERT INTO model_sampler_defaults (model, temperature, max_tokens, top_p, top_k, repetition_penalty, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (model) DO UPDATE SET
           temperature = excluded.temperature,
           max_tokens = excluded.max_tokens,
           top_p = excluded.top_p,
           top_k = excluded.top_k,
           repetition_penalty = excluded.repetition_penalty,
           updated_at = excluded.updated_at`
      )
      .run(model, next.temperature, next.maxTokens, next.topP, next.topK, next.repetitionPenalty, next.enabled ? 1 : 0, now);

    return this.getForModel(model)!;
  }

  /** Toggles whether this model is offered in Chat's model dropdown -- see the `enabled`
   * column's docstring in schema.ts. A dedicated upsert (not `upsert`, which is sampler-only)
   * since this needs to create a row purely to carry this one flag, with every sampler field
   * left null (falling back to the recommended defaults, same as a model with no row at all). */
  setEnabled(model: string, enabled: boolean): ModelSamplerDefaults {
    const existing = this.getForModel(model);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO model_sampler_defaults (model, temperature, max_tokens, top_p, top_k, repetition_penalty, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (model) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(
        model,
        existing?.temperature ?? null,
        existing?.maxTokens ?? null,
        existing?.topP ?? null,
        existing?.topK ?? null,
        existing?.repetitionPenalty ?? null,
        enabled ? 1 : 0,
        now
      );
    return this.getForModel(model)!;
  }

  /** Clears one field back to "use the global default" -- distinct from deleting the whole
   * row, since a model might have other fields still customized. */
  resetField(model: string, field: keyof SamplerParams): void {
    const existing = this.getForModel(model);
    if (!existing) return;
    const column =
      field === 'temperature'
        ? 'temperature'
        : field === 'maxTokens'
          ? 'max_tokens'
          : field === 'topP'
            ? 'top_p'
            : field === 'topK'
              ? 'top_k'
              : 'repetition_penalty';
    this.db
      .prepare(`UPDATE model_sampler_defaults SET ${column} = NULL, updated_at = ? WHERE model = ?`)
      .run(new Date().toISOString(), model);
  }

  /** Removes the model's row entirely -- "use the global default" for everything. */
  resetAll(model: string): void {
    this.db.prepare(`DELETE FROM model_sampler_defaults WHERE model = ?`).run(model);
  }
}
