import { useEffect, useState } from 'react';
import { ModelSamplerDefaults, SamplerParams } from '../../shared/types/chat';
import { OllamaModelInfo } from '../../shared/types/ollama';
import { detectModelFamily } from '../../shared/utils/modelFamily';
import { familyDisplayName, modelNotes } from '../utils/modelPresentation';

interface FieldSpec {
  key: keyof SamplerParams;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
}

// Same bounds toOllamaOptions (chatSession.ts) ultimately clamps to -- shown here so a value
// typed outside them doesn't silently do something different from what it looks like it does.
const FIELDS: FieldSpec[] = [
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0.1,
    max: 1.5,
    step: 0.1,
    description:
      'Randomness in word choice. Lower = more focused and predictable; higher = more varied and creative, but more likely to wander or lose coherence.',
  },
  {
    key: 'maxTokens',
    label: 'Max Tokens',
    min: 64,
    max: 2048,
    step: 64,
    description:
      "Hard cap on reply length, in tokens (~3/4 of a word each). Too low cuts a reply off mid-thought; too high just wastes time generating past where the reply would naturally end -- it doesn't force longer replies.",
  },
  {
    key: 'topP',
    label: 'Top P',
    min: 0.1,
    max: 1,
    step: 0.05,
    description:
      'Nucleus sampling: only considers the smallest set of next-word candidates whose combined probability reaches this fraction. Lower = narrower, safer word choices; higher (closer to 1) = considers more options.',
  },
  {
    key: 'topK',
    label: 'Top K',
    min: 1,
    max: 100,
    step: 1,
    description:
      'Only considers this many of the most likely next words at each step, before Top P narrows that further. Lower = more focused and repetitive; higher = more variety.',
  },
  {
    key: 'repetitionPenalty',
    label: 'Repetition Penalty',
    min: 1,
    max: 2,
    step: 0.05,
    description:
      'Discourages reusing words/phrases already said. 1 = no penalty. Higher reduces repetition but can push toward stranger word choices or avoiding words that should naturally repeat (like a character\'s own name) if set too high.',
  },
];

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
}

/** Compact form for a context window, e.g. 131072 -> "131K". */
function formatContext(tokens: number | null): string {
  if (!tokens) return '';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

const CAPABILITY_ICONS: Record<string, string> = {
  tools: '🛠',
  vision: '👁',
  thinking: '🧠',
};

const CAPABILITY_LABELS: Record<string, string> = {
  tools: 'Tool/function calling',
  vision: 'Image input',
  thinking: 'Hidden reasoning ("thinking") pass',
};

export default function ModelTuning() {
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);
  const [ollamaMessage, setOllamaMessage] = useState('');
  const [models, setModels] = useState<OllamaModelInfo[]>([]);
  const [customRows, setCustomRows] = useState<Record<string, ModelSamplerDefaults>>({});
  const [recommended, setRecommended] = useState<Record<string, SamplerParams>>({});
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<keyof SamplerParams, string>>>>({});
  const [busyModel, setBusyModel] = useState<string | null>(null);

  async function load() {
    const [modelsResult, rows] = await Promise.all([
      window.electronAPI.ollama.listModelsDetailed(),
      window.electronAPI.modelTuning.getAll(),
    ]);

    setOllamaAvailable(modelsResult.available);
    setOllamaMessage(modelsResult.available ? '' : modelsResult.message);

    const rowsByModel: Record<string, ModelSamplerDefaults> = {};
    for (const row of rows) rowsByModel[row.model] = row;
    setCustomRows(rowsByModel);

    // A model that's been tuned but is no longer installed still gets a (bare) row, rather
    // than its override silently vanishing from the page -- same reasoning as before, just
    // without the real metadata an uninstalled model has none of.
    const installedNames = new Set(modelsResult.models.map((m) => m.name));
    const orphaned: OllamaModelInfo[] = rows
      .filter((r) => !installedNames.has(r.model))
      .map((r) => ({ name: r.model, sizeBytes: 0, family: '', parameterSize: '', quantization: '', contextLength: null, capabilities: [] }));

    const allModels = [...modelsResult.models, ...orphaned].sort((a, b) => a.name.localeCompare(b.name));
    setModels(allModels);

    // What each field falls back to before any actually-saved override -- the family preset
    // layered over the global default, per model. Fetched per row rather than once globally,
    // since it's no longer the same flat number for every model.
    const recommendedByModel: Record<string, SamplerParams> = {};
    await Promise.all(
      allModels.map(async (m) => {
        recommendedByModel[m.name] = await window.electronAPI.modelTuning.getRecommended(m.name);
      })
    );
    setRecommended(recommendedByModel);

    setDrafts({});
  }

  useEffect(() => {
    void load();
  }, []);

  function displayValue(model: string, field: FieldSpec): string {
    const draft = drafts[model]?.[field.key];
    if (draft !== undefined) return draft;
    const custom = customRows[model]?.[field.key];
    if (custom != null) return String(custom);
    return '';
  }

  function placeholder(model: string, field: FieldSpec): string {
    const value = recommended[model]?.[field.key];
    return value != null ? String(value) : '';
  }

  function isCustomized(model: string, field: FieldSpec): boolean {
    return customRows[model]?.[field.key] != null;
  }

  /** Explains where an unset field's placeholder value actually comes from -- a family-specific
   * recommendation (RolePlaymate's own preset, same origin as the Notes column) vs just the
   * flat global default, since those look identical in the input otherwise. */
  function fieldTitle(model: string, field: FieldSpec): string | undefined {
    if (isCustomized(model, field)) return 'Customized for this model';
    const family = detectModelFamily(model);
    return family
      ? `Recommended default for this model line (not from Ollama) -- type a value to override it`
      : undefined;
  }

  function modelHasAnyCustomization(model: string): boolean {
    const row = customRows[model];
    return !!row && FIELDS.some((f) => row[f.key] != null);
  }

  function setDraft(model: string, field: FieldSpec, value: string) {
    setDrafts((current) => ({ ...current, [model]: { ...current[model], [field.key]: value } }));
  }

  /** Clears a field's draft so it falls back to displaying whatever's actually saved (or the
   * placeholder, if nothing is) -- used after a rejected edit, since there's nothing there
   * worth reverting *to* other than what was already in effect before the user typed. */
  function revertDraft(model: string, field: FieldSpec) {
    setDrafts((current) => {
      if (current[model]?.[field.key] === undefined) return current;
      const rest = { ...current[model] };
      delete rest[field.key];
      return { ...current, [model]: rest };
    });
  }

  /** Null when valid. Range comes from the same FIELDS spec the input's own min/max/step use,
   * so this can't disagree with what the field visually advertises as acceptable. */
  function validate(field: FieldSpec, raw: string): string | null {
    if (raw.trim() === '') return null; // blank is valid -- resets to the recommended default
    const num = Number(raw);
    if (!Number.isFinite(num)) return 'Must be a number';
    if (num < field.min || num > field.max) return `Must be between ${field.min} and ${field.max}`;
    if ((field.key === 'maxTokens' || field.key === 'topK') && !Number.isInteger(num)) {
      return 'Must be a whole number';
    }
    return null;
  }

  async function commitField(model: string, field: FieldSpec) {
    const raw = drafts[model]?.[field.key];
    if (raw === undefined) return;

    // There's no explicit Save button here -- a field just autosaves on blur -- so an invalid
    // value can't be left sitting silently in the box with only a hover tooltip to explain it;
    // it needs to interrupt and say so, then put the field back to whatever it actually was.
    const error = validate(field, raw);
    if (error) {
      alert(`${field.label}: ${error}`);
      revertDraft(model, field);
      return;
    }

    setBusyModel(model);
    try {
      if (raw.trim() === '') {
        await window.electronAPI.modelTuning.resetField(model, field.key);
      } else {
        await window.electronAPI.modelTuning.update(model, { [field.key]: Number(raw) });
      }
      await load();
    } finally {
      setBusyModel(null);
    }
  }

  async function resetModel(model: string) {
    setBusyModel(model);
    try {
      await window.electronAPI.modelTuning.resetAll(model);
      await load();
    } finally {
      setBusyModel(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Model Tuning</h1>
      </div>

      <p className="text-muted">
        Sampler defaults per Ollama model -- some models drift toward their own style (a fixed
        temperature, a habit of over-using certain punctuation, ...) and respond better to
        slightly different settings than others. A blank field shows a placeholder and uses that
        value for real generation. Type a value to override it for that model specifically --
        that becomes what&apos;s actually used (and shown as the real value, not a placeholder)
        every time that model is picked, until reset. The chat composer&apos;s Temperature/Max
        Tokens sliders can still override this for one turn on top of whatever&apos;s set here.
      </p>

      <p className="text-muted" style={{ fontSize: 12 }}>
        Params/Quant/Context/Size/Capabilities are reported directly by Ollama. The Notes* column
        and the placeholder values are not -- both are RolePlaymate&apos;s own general
        characterization of how each model line tends to behave in roleplay (same reasoning
        behind each), not something verified against your specific install. Hover a blank field
        to see whether its placeholder is a model-specific recommendation or just the flat
        global default.
      </p>

      {ollamaAvailable === false && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p className="text-muted" style={{ margin: 0 }}>
            Ollama isn&apos;t reachable ({ollamaMessage || 'not running'}) -- can&apos;t list installed models to
            tune right now.
          </p>
        </div>
      )}

      {ollamaAvailable && models.length === 0 && (
        <div className="text-muted">No models installed yet.</div>
      )}

      {models.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 10px 6px 0' }}>Model</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Params</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Quant</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Context</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Size</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Capabilities</th>
                <th
                  style={{ textAlign: 'left', padding: '6px 10px' }}
                  title="Not reported by Ollama -- these are RolePlaymate's own general notes on how this model line tends to behave in a roleplay chat, not a verified fact about your specific install"
                >
                  Notes*
                </th>
                {FIELDS.map((f) => (
                  <th key={f.key} style={{ textAlign: 'left', padding: '6px 10px' }} title={f.description}>
                    <div>{f.label}</div>
                    <div className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>
                      {f.min}–{f.max}
                    </div>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {models.map((info) => (
                <tr key={info.name} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>
                    {info.family && (
                      <div style={{ fontWeight: 600 }}>{familyDisplayName(info.family)}</div>
                    )}
                    <div className={info.family ? 'text-muted' : undefined} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {info.name}
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }} title={info.parameterSize ? undefined : 'Not reported by Ollama'}>
                    {info.parameterSize || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }} title={info.quantization ? undefined : 'Not reported by Ollama'}>
                    {info.quantization || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }} title={info.contextLength ? undefined : 'Not reported by Ollama'}>
                    {formatContext(info.contextLength) || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }} title={info.sizeBytes ? undefined : 'Not reported by Ollama'}>
                    {formatBytes(info.sizeBytes) || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {(() => {
                      const extra = info.capabilities.filter((c) => c !== 'completion');
                      if (extra.length === 0) {
                        return (
                          <span className="text-muted" title="No special capabilities -- plain text completion only">
                            Text only
                          </span>
                        );
                      }
                      return (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          {extra.map((c) => (
                            <span key={c} title={CAPABILITY_LABELS[c] ?? c}>
                              {CAPABILITY_ICONS[c] ?? c}
                            </span>
                          ))}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ padding: '8px 10px', maxWidth: 220 }}>
                    {(() => {
                      const notes = modelNotes(info.name);
                      if (!notes) {
                        return (
                          <span className="text-muted" style={{ fontStyle: 'italic' }}>
                            No notes yet
                          </span>
                        );
                      }
                      return (
                        <span style={{ fontStyle: 'italic' }} title={notes.detail}>
                          {notes.summary}
                        </span>
                      );
                    })()}
                  </td>
                  {FIELDS.map((field) => (
                    <td key={field.key} style={{ padding: '8px 10px' }}>
                      <input
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={displayValue(info.name, field)}
                        placeholder={placeholder(info.name, field)}
                        title={fieldTitle(info.name, field)}
                        style={{
                          width: 90,
                          borderColor: isCustomized(info.name, field) ? 'var(--color-primary-action)' : undefined,
                        }}
                        disabled={busyModel === info.name}
                        onChange={(e) => setDraft(info.name, field, e.target.value)}
                        onBlur={() => void commitField(info.name, field)}
                      />
                    </td>
                  ))}
                  <td style={{ padding: '8px 0' }}>
                    <button
                      className="btn"
                      disabled={!modelHasAnyCustomization(info.name) || busyModel === info.name}
                      onClick={() => void resetModel(info.name)}
                    >
                      Reset
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {models.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Sampler Parameters</h2>
          <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
            What each column actually changes, and the range this page accepts (typing outside
            it is rejected, not silently clamped).
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f.key}>
                  <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 600 }}>{f.label}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      {f.min}–{f.max}
                    </div>
                  </td>
                  <td className="text-muted" style={{ padding: '6px 0' }}>
                    {f.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {models.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Capabilities</h2>
          <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
            What Ollama reports each model can do beyond plain text completion. A model showing
            none of these still works for chat -- it just doesn&apos;t support that extra
            capability, the same as every other model here that doesn&apos;t list it.
          </p>
          <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
            Informational only -- RolePlaymate doesn&apos;t currently use any of these for chat.
            Tool calls and images are never sent, and the &quot;thinking&quot; pass is explicitly
            turned off on every request, whether or not a model supports it.
          </p>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {Object.entries(CAPABILITY_ICONS).map(([key, icon]) => (
              <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16 }}>{icon}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {CAPABILITY_LABELS[key]}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
