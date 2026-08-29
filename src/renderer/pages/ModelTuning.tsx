import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ModelSamplerDefaults, SamplerParams } from '../../shared/types/chat';
import { OllamaModelInfo } from '../../shared/types/ollama';
import { DEFAULT_EMBEDDING_MODEL, isEmbeddingModel } from '../../shared/embeddingModel';
import { detectModelFamily } from '../../shared/utils/modelFamily';
import { displayModelName, assignModelTiers, modelCompositeScore, MODEL_TIER_COLORS, ModelTier } from '../utils/modelPresentation';
import OllamaRequiredGate from '../components/chat/OllamaRequiredGate';

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
  thinking: 'Thinking',
  embed: 'Text embeddings',
};

type TuningTab = 'chat' | 'embedding';

export default function ModelTuning() {
  return (
    <OllamaRequiredGate>
      <ModelTuningPage />
    </OllamaRequiredGate>
  );
}

function ModelTuningPage() {
  const [tab, setTab] = useState<TuningTab>('chat');
  const [models, setModels] = useState<OllamaModelInfo[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<OllamaModelInfo[]>([]);
  const [activeEmbeddingModel, setActiveEmbeddingModel] = useState(DEFAULT_EMBEDDING_MODEL);
  const [tiers, setTiers] = useState<Record<string, ModelTier>>({});
  const [customRows, setCustomRows] = useState<Record<string, ModelSamplerDefaults>>({});
  const [recommended, setRecommended] = useState<Record<string, SamplerParams>>({});
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<keyof SamplerParams, string>>>>({});
  const [busyModel, setBusyModel] = useState<string | null>(null);

  async function load() {
    const [modelsResult, rows, embeddingConfig] = await Promise.all([
      window.electronAPI.ollama.listModelsDetailed(),
      window.electronAPI.modelTuning.getAll(),
      window.electronAPI.memoryEmbeddingModel.get(),
    ]);

    setActiveEmbeddingModel(embeddingConfig.model);

    const rowsByModel: Record<string, ModelSamplerDefaults> = {};
    for (const row of rows) rowsByModel[row.model] = row;
    setCustomRows(rowsByModel);

    const installedNames = new Set(modelsResult.models.map((m) => m.name));
    const chatModels = modelsResult.models.filter((m) => !isEmbeddingModel(m));
    const embedding = modelsResult.models
      .filter((m) => isEmbeddingModel(m))
      .sort((a, b) => a.name.localeCompare(b.name));
    setEmbeddingModels(embedding);
    const orphaned: OllamaModelInfo[] = rows
      .filter((r) => !installedNames.has(r.model) && !isEmbeddingModel(r.model))
      .map((r) => ({ name: r.model, sizeBytes: 0, family: '', parameterSize: '', quantization: '', contextLength: null, capabilities: [] }));

    // Ranked best-to-worst for this app's purposes (see compositeScore/assignTiers) rather
    // than alphabetically -- the list had no inherent order otherwise. Disabled models group
    // together below every enabled one, ranked among themselves the same way, so turning a
    // model off moves it out of the way without losing where it'd otherwise rank.
    const tiersByModel = assignModelTiers(chatModels);
    setTiers(tiersByModel);
    const enabled = (m: OllamaModelInfo) => rowsByModel[m.name]?.enabled ?? true;
    const allModels = [...chatModels, ...orphaned].sort((a, b) => {
      const enabledDiff = Number(enabled(b)) - Number(enabled(a));
      if (enabledDiff !== 0) return enabledDiff;
      return modelCompositeScore(b) - modelCompositeScore(a) || a.name.localeCompare(b.name);
    });
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

  useEffect(() => {
    if (tab !== 'embedding') return;
    void window.electronAPI.memoryEmbeddingModel.get().then((config) => {
      setActiveEmbeddingModel(config.model);
    });
    void window.electronAPI.ollama.listModelsDetailed().then((modelsResult) => {
      if (modelsResult.available) {
        setEmbeddingModels(
          modelsResult.models
            .filter((m) => isEmbeddingModel(m))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      }
    });
  }, [tab]);

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
   * recommendation (RolePlaymate's own sampler preset) vs just the flat global default, since
   * those look identical in the input otherwise. */
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

  // No row at all means enabled -- same "absence is the default" convention every sampler
  // field on this table already uses.
  function isEnabled(model: string): boolean {
    return customRows[model]?.enabled ?? true;
  }

  async function toggleEnabled(model: string, enabled: boolean) {
    setBusyModel(model);
    try {
      await window.electronAPI.modelTuning.setEnabled(model, enabled);
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

      <div className="model-tuning-tabs" role="tablist" aria-label="Model tuning views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={`model-tuning-tab${tab === 'chat' ? ' active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat models
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'embedding'}
          className={`model-tuning-tab${tab === 'embedding' ? ' active' : ''}`}
          onClick={() => setTab('embedding')}
        >
          Embedding models
        </button>
      </div>

      {tab === 'chat' && (
        <>
      <p className="text-muted">
        App default sampler values per Ollama model can be tuned here.
      </p>

      <p className="text-muted" style={{ fontSize: 12 }}>
        Params/Quant/Context/Size/Capabilities are reported directly by Ollama. Tier is computed
        from those values, so it&apos;s a general indicator of how capable a model is -- it may
        not correlate with suitability or tuning for roleplay specifically.
      </p>

      {models.length === 0 && (
        <div className="text-muted">No chat models installed yet.</div>
      )}

      {models.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="zebra-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 10px 6px 0' }}>Model</th>
                <th
                  style={{ textAlign: 'left', padding: '6px 10px' }}
                  title="RolePlaymate's ranking -- computed automatically from parameter count, quantization, and context window (all reported by Ollama), not a curated per-model judgment. Sets the row order above."
                >
                  Tier
                </th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Params</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Quant</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Context</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Size</th>
                <th style={{ textAlign: 'left', padding: '6px 10px' }}>Capabilities</th>
                {FIELDS.map((f) => (
                  <th key={f.key} style={{ textAlign: 'left', padding: '6px 10px' }} title={f.description}>
                    <div>{f.label}</div>
                    <div className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>
                      {f.min}–{f.max}
                    </div>
                  </th>
                ))}
                <th />
                <th
                  style={{ textAlign: 'left', padding: '6px 10px' }}
                  title="Whether this model is offered in Chat's model dropdown -- doesn't affect what's installed in Ollama"
                >
                  Enabled
                </th>
              </tr>
            </thead>
            <tbody>
              {models.map((info, i) => {
                const enabled = isEnabled(info.name);
                // Enabled rows sort before disabled ones (see load()) -- a heavier, accented
                // divider right at that boundary makes the split obvious at a glance instead of
                // just reading as a gradually-fading list.
                const isFirstDisabled = !enabled && i > 0 && isEnabled(models[i - 1].name);
                const rowStyle: React.CSSProperties = {
                  borderTop: isFirstDisabled ? '2px solid var(--color-primary-action)' : '1px solid var(--color-border)',
                  opacity: enabled ? 1 : 0.45,
                };
                const tier = tiers[info.name];
                return (
                <tr key={info.name} style={rowStyle}>
                  <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>
                    {info.family && (
                      <div style={{ fontWeight: 600 }}>{displayModelName(info)}</div>
                    )}
                    <div className={info.family ? 'text-muted' : undefined} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {info.name}
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {tier ? (
                      <span style={{ fontWeight: 600, color: MODEL_TIER_COLORS[tier] }}>{tier}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
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
                        disabled={busyModel === info.name || !enabled}
                        onChange={(e) => setDraft(info.name, field, e.target.value)}
                        onBlur={() => void commitField(info.name, field)}
                      />
                    </td>
                  ))}
                  <td style={{ padding: '8px 0' }}>
                    <button
                      className="btn"
                      disabled={!modelHasAnyCustomization(info.name) || busyModel === info.name || !enabled}
                      onClick={() => void resetModel(info.name)}
                    >
                      Reset
                    </button>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={busyModel === info.name}
                      title={enabled ? 'Shown in Chat’s model dropdown' : 'Hidden from Chat’s model dropdown'}
                      onChange={(e) => void toggleEnabled(info.name, e.target.checked)}
                    />
                  </td>
                </tr>
                );
              })}
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
          <table className="zebra-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Model Terminology</h2>
          <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
            What Params/Quant/Context/Size mean and why they matter for picking a model.
          </p>
          <table className="zebra-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Params
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  How many weights the model has -- roughly its "brain size." More generally means
                  better reasoning, richer writing, and fewer dumb mistakes, at the cost of needing
                  more RAM/VRAM and running slower. Example: a 7B model is small and fast; a 32B
                  model is noticeably smarter but needs a lot more hardware to run comfortably.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Quant
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  How much each weight has been compressed from the model's original precision to
                  shrink the file and speed it up. Lower quants (Q2/Q3/Q4) are smaller and faster
                  but can lose some coherence and nuance; higher ones (Q6/Q8, or F16 for
                  uncompressed) are closer to the model's true output but larger and slower.
                  Example: Q4_K_M is a common "good enough" middle ground; Q8_0 is near-lossless
                  but roughly double the size of a Q4.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Context
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  How many tokens (roughly 3/4 of a word each) the model can hold in mind at once
                  -- the system prompt, memories, and conversation history all share this budget.
                  Once a conversation grows past it, the oldest turns fall out of what the model
                  can see. Matters most for a long-running roleplay you want to keep coherent for
                  hundreds of messages; matters less for short one-off chats. Example: 8K is tight
                  for a long scene, 32K–128K is comfortable, 1M is effectively "won't run out."
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Size
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  How much disk space the model file takes up at rest -- driven by both Params and
                  Quant together (more params or a higher quant both mean a bigger file). It's not
                  a hard VRAM requirement: Ollama splits a model across GPU and system RAM when it
                  doesn't fully fit in VRAM, running the GPU-resident part fast and the rest
                  slower on CPU, rather than refusing to load. A model that's mostly or fully in
                  VRAM feels snappy; one leaning heavily on CPU offload still works, just visibly
                  slower generating each reply. On top of Size, the KV cache adds more as a
                  conversation fills up more of the Context window.
                </td>
              </tr>
            </tbody>
          </table>

          <h3 style={{ fontSize: 13, marginTop: 20, marginBottom: 2 }}>Units &amp; terms</h3>
          <p className="text-muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 12 }}>
            The letters and abbreviations that show up above, spelled out.
          </p>
          <table className="zebra-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  B
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  <em>Billion</em> -- the unit Params is counted in. "12B" is said "twelve B" or
                  "a twelve-billion-parameter model." A model's B number is the single most common
                  shorthand for how big/capable it roughly is.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  M
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  <em>Million</em>. Shows up two different ways on this page: a small model's
                  Params count ("638M" = 638 million parameters -- smaller than any "B" model), or
                  a huge Context window ("1.0M" = about one million tokens).
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  K
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  <em>Thousand</em>. Only shows up in Context here -- "131K" is said "131 thousand"
                  and means about 131,000 tokens of context.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Token
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  The actual unit a model reads and writes in -- not quite a word, roughly 3/4 of
                  one on average ("hello there" is about 2-3 tokens). Every K/M in the Context
                  column is counting tokens, not words or characters.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Qx (Q4, Q5, Q8...)
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  The number in a Quant label -- roughly how many bits represent each weight. Said
                  "Q-four," "Q-five," etc., or "four-bit quantization." Higher = closer to the
                  original model's quality but a bigger file; this is the number worth comparing,
                  more than the letters after it.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  _K_M / _0 / _K_S suffixes
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  The letters after a Quant's number (e.g. the "_K_M" in "Q4_K_M") name the
                  specific compression method and size variant within that bit-width -- not worth
                  memorizing. Treat the leading Q-number as the meaningful part and these as an
                  implementation detail.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Quantized / quantization
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  Compressing a model's weights down from the precision they were trained at to
                  fewer bits, trading a little quality for a much smaller, faster-to-run file.
                  Every model on this page with a Qx quant level <em>is</em> a quantized model --
                  that compression is what makes it small enough to run locally at all.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Parameters / weights
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  The (typically billions of) numbers a model learned during training. "Parameter
                  count" and "weights" are used interchangeably, and both are shorthand for
                  roughly how big/capable a model is -- the same number the Params column reports.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  Inference
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  Actually running a model to generate a reply, as opposed to training it. This is
                  what your machine is doing every time a chat message goes out -- how fast it
                  happens depends heavily on Params, Quant, and your hardware.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  F16 / FP16 (FP32)
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  "Full precision" or "half precision" -- an unquantized or lightly-compressed
                  model, before any Qx quantization is applied. The largest and slowest option,
                  closest to the model exactly as it was trained.
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px 6px 0', whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: 600 }}>
                  VRAM / RAM
                </td>
                <td className="text-muted" style={{ padding: '6px 0' }}>
                  The memory a model's weights and active context (KV cache) occupy while it
                  runs. VRAM (the GPU's own memory) is what makes generation fast; system RAM is
                  the fallback Ollama spills into for whatever doesn't fit in VRAM, which still
                  works but runs slower. A model needing more VRAM than a GPU has doesn't fail to
                  load -- it just leans more on that slower fallback.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {models.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Capabilities</h2>
          <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
            What Ollama reports each model can do beyond plain text. Informational only --
            RolePlaymate doesn&apos;t use any of these for chat.
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
        </>
      )}

      {tab === 'embedding' && (
        <>
          <p className="text-muted">
            Embedding models power semantic memory retrieval. Choose which one is active in{' '}
            <Link to="/settings">Settings</Link> under Memory embedding model.
          </p>
          <p className="text-muted" style={{ fontSize: 12 }}>
            Per-model tuning options for embeddings will appear here as they&apos;re added. For now,
            install models with Ollama and switch between them in Settings.
          </p>

          {embeddingModels.length === 0 && (
            <div className="text-muted">No embedding models installed yet.</div>
          )}

          {embeddingModels.length > 0 && (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="zebra-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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
                      title="The model Settings uses for semantic memory retrieval"
                    >
                      Active
                    </th>
                    <th style={{ textAlign: 'left', padding: '6px 10px' }}>Tuning</th>
                  </tr>
                </thead>
                <tbody>
                  {embeddingModels.map((info) => {
                    const isActive = info.name === activeEmbeddingModel;
                    return (
                      <tr key={info.name} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '8px 10px 8px 0', whiteSpace: 'nowrap' }}>
                          {info.family && (
                            <div style={{ fontWeight: 600 }}>{displayModelName(info)}</div>
                          )}
                          <div
                            className={info.family ? 'text-muted' : undefined}
                            style={{ fontFamily: 'monospace', fontSize: 12 }}
                          >
                            {info.name}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {info.parameterSize || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {info.quantization || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {formatContext(info.contextLength) || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {formatBytes(info.sizeBytes) || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {(() => {
                            const extra = info.capabilities.filter((c) => c !== 'completion');
                            if (extra.length === 0) {
                              return <span className="text-muted">Embeddings</span>;
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
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {isActive ? (
                            <span style={{ fontWeight: 600, color: 'var(--color-accent-green)' }}>Active</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="text-muted" style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          —
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
