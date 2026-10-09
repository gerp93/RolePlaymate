import { useCallback, useEffect, useMemo, useState } from 'react';
import { Character } from '../../shared/types/character';
import { UserPersona } from '../../shared/types/userPersona';
import { Scenario } from '../../shared/types/scenario';
import {
  AutomationExportFormat,
  BenchmarkDetail,
  BenchmarkModelResult,
  BenchmarkProgress,
  BenchmarkSummary,
  MAX_BENCHMARK_TURNS,
  MIN_BENCHMARK_TURNS,
} from '../../shared/types/automation';
import { useSecurity } from '../context/SecurityContext';
import AutomationProgress from './chat/AutomationProgress';

interface Props {
  /** Chat models shown on this page (enabled ones), by tag. */
  models: string[];
}

const STATUS_LABEL: Record<BenchmarkSummary['status'], string> = {
  running: 'Running',
  completed: 'Completed',
  stopped: 'Stopped',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

const seconds = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(1)}s`);
const fixed = (value: number | null, digits: number) => (value === null ? '-' : value.toFixed(digits));

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Model Tuning -> Speed test. Runs the same short automated chat once per chosen model, one after
 * another, and compares how fast each one writes. See main/chat/automationRunner.ts (startBenchmark)
 * and benchmarkStats.ts for what is measured and why the figures are medians that skip the first
 * reply.
 */
export default function SpeedTestPanel({ models }: Props) {
  const { hiddenUnlocked } = useSecurity();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [characterId, setCharacterId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [scenarioId, setScenarioId] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [turns, setTurns] = useState(12);
  const [scripted, setScripted] = useState(true);
  const [keep, setKeep] = useState(false);

  const [progress, setProgress] = useState<BenchmarkProgress | null>(null);
  const [tests, setTests] = useState<BenchmarkSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BenchmarkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const running = progress !== null && progress.benchmark.status === 'running';

  const refreshTests = useCallback(async () => {
    setTests(await window.electronAPI.benchmark.list());
  }, []);

  useEffect(() => {
    void Promise.all([window.electronAPI.characters.getAll(), window.electronAPI.personas.getAll()]).then(
      ([characterList, personaList]) => {
        setCharacters(characterList);
        setPersonas(personaList);
      }
    );
    void window.electronAPI.benchmark.getActive().then((active) => {
      setProgress(active);
      if (active) setSelectedId(active.benchmark.id);
    });
    void refreshTests();
  }, [refreshTests]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.benchmark.onProgress((next) => {
      const live = next.benchmark.status === 'running';
      setProgress(live ? next : null);
      setSelectedId((current) => current ?? next.benchmark.id);
      if (!live) void refreshTests();
    });
    return unsubscribe;
  }, [refreshTests]);

  // Results fill in as each model finishes, so refetch whenever the shown test gains a result.
  const finishedModels = progress?.benchmark.finishedModels ?? 0;
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void window.electronAPI.benchmark
      .get(selectedId)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, finishedModels, running, tests]);

  useEffect(() => {
    if (!characterId) {
      setScenarios([]);
      setScenarioId('');
      return;
    }
    void window.electronAPI.scenarios.getByCharacter(characterId).then((list) => {
      setScenarios(list.filter((scenario) => hiddenUnlocked || !scenario.isHidden));
      setScenarioId('');
    });
  }, [characterId, hiddenUnlocked]);

  const visibleCharacters = useMemo(
    () => characters.filter((c) => (hiddenUnlocked || !c.isHidden) && !c.isQuick),
    [characters, hiddenUnlocked]
  );
  const visiblePersonas = useMemo(
    () => personas.filter((p) => hiddenUnlocked || !p.isHidden),
    [personas, hiddenUnlocked]
  );

  const turnsValid = Number.isInteger(turns) && turns >= MIN_BENCHMARK_TURNS && turns <= MAX_BENCHMARK_TURNS;
  const blocker = !characterId
    ? 'Pick a character.'
    : !personaId
      ? 'Pick a persona.'
      : chosen.length === 0
        ? 'Tick at least one model.'
        : !turnsValid
          ? `Turns must be a whole number from ${MIN_BENCHMARK_TURNS} to ${MAX_BENCHMARK_TURNS}.`
          : null;

  const toggleModel = (name: string) =>
    setChosen((current) => (current.includes(name) ? current.filter((m) => m !== name) : [...current, name]));

  const start = async () => {
    setError(null);
    setNotice(null);
    try {
      const summary = await window.electronAPI.benchmark.start({
        characterId,
        personaId,
        scenarioId: scenarioId || null,
        models: chosen,
        turns,
        scripted,
        keepConversations: keep,
      });
      setSelectedId(summary.id);
      setProgress({ benchmark: summary, model: null, completedTurns: 0, requestedTurns: turns });
    } catch (startError) {
      setError((startError as Error).message);
    }
  };

  const exportTest = async (id: string, format: AutomationExportFormat) => {
    setNotice(null);
    try {
      const result = await window.electronAPI.benchmark.export(id, format);
      if (result.saved) setNotice(`Saved to ${result.path}`);
    } catch (exportError) {
      setNotice(`Export failed: ${(exportError as Error).message}`);
    }
  };

  const deleteTest = async (id: string) => {
    setConfirmDelete(false);
    try {
      await window.electronAPI.benchmark.delete(id);
      if (selectedId === id) setSelectedId(null);
      await refreshTests();
    } catch (deleteError) {
      setNotice(`Delete failed: ${(deleteError as Error).message}`);
    }
  };

  const ordered: BenchmarkModelResult[] = detail
    ? [...detail.results].sort((a, b) => (b.medianTokensPerSec ?? -1) - (a.medianTokensPerSec ?? -1))
    : [];

  // Whole-test progress: finished models plus the turns done on the current one.
  const overall = progress
    ? Math.min(
        progress.benchmark.models.length * progress.benchmark.turns,
        progress.benchmark.finishedModels * progress.benchmark.turns + progress.completedTurns
      )
    : 0;
  const overallTotal = progress ? progress.benchmark.models.length * progress.benchmark.turns : 0;

  return (
    <div>
      <p className="text-muted" style={{ fontSize: 12 }}>
        Runs the same short chat once per model you tick, one after another, and compares how fast each one writes
        on this PC. Each model gets its own fresh conversation, and is unloaded from Ollama afterwards so the next
        is timed from a cold start. The first reply is left out of the figures, because it includes loading the
        model; that cost is shown on its own.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Run a speed test</h2>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 200 }}>
            <label>Character</label>
            <select value={characterId} disabled={running} onChange={(e) => setCharacterId(e.target.value)}>
              <option value="">Select…</option>
              {visibleCharacters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label>Persona</label>
            <select value={personaId} disabled={running} onChange={(e) => setPersonaId(e.target.value)}>
              <option value="">Select…</option>
              {visiblePersonas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label>Scenario (optional)</label>
            <select
              value={scenarioId}
              disabled={running || scenarios.length === 0}
              onChange={(e) => setScenarioId(e.target.value)}
            >
              <option value="">None</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 120 }}>
            <label>Turns per model</label>
            <input
              type="number"
              min={MIN_BENCHMARK_TURNS}
              max={MAX_BENCHMARK_TURNS}
              disabled={running}
              value={Number.isNaN(turns) ? '' : turns}
              onChange={(e) => setTurns(e.target.value === '' ? NaN : Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field">
          <label>Models to test</label>
          {models.length === 0 && <p className="text-muted">No chat models are enabled.</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
            {models.map((name) => (
              <label key={name} className="settings-checkbox-row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(name)}
                  disabled={running}
                  onChange={() => toggleModel(name)}
                />
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{name}</span>
              </label>
            ))}
          </div>
          {models.length > 1 && (
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <button type="button" className="btn" disabled={running} onClick={() => setChosen([...models])}>
                Select all
              </button>
              <button type="button" className="btn" disabled={running} onClick={() => setChosen([])}>
                Clear
              </button>
            </div>
          )}
        </div>

        <label className="settings-checkbox-row">
          <input type="checkbox" checked={scripted} disabled={running} onChange={(e) => setScripted(e.target.checked)} />
          Send the same generic lines to every model (recommended)
        </label>
        <p className="text-muted" style={{ fontSize: 12, margin: '0 0 8px 24px' }}>
          Lines like &ldquo;Tell me more about that.&rdquo; that make sense after any reply, so every model is sent
          exactly the same words and the figures compare fairly. Off: each model writes the persona&apos;s side
          itself, which is more realistic but gives every model a different conversation (and adds a drafting call).
        </p>
        <label className="settings-checkbox-row">
          <input type="checkbox" checked={keep} disabled={running} onChange={(e) => setKeep(e.target.checked)} />
          Keep each model&apos;s test conversation
        </label>
        <p className="text-muted" style={{ fontSize: 12, margin: '0 0 8px 24px' }}>
          Off: the conversations are deleted as each model finishes. The results are kept either way.
        </p>

        {running && progress ? (
          <>
            <AutomationProgress
              completedTurns={overall}
              requestedTurns={overallTotal}
              label={`Model ${Math.min(progress.benchmark.finishedModels + 1, progress.benchmark.models.length)} of ${progress.benchmark.models.length}`}
              detail={
                progress.model
                  ? `${progress.model} -- turn ${Math.min(progress.completedTurns + 1, progress.requestedTurns)} of ${progress.requestedTurns}`
                  : 'Starting…'
              }
            />
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-danger" onClick={() => void window.electronAPI.benchmark.stop()}>
                Stop
              </button>
            </div>
            <p className="text-muted" style={{ fontSize: 12 }}>
              Leave the PC alone while this runs: anything else using the GPU skews the timings.
            </p>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled={Boolean(blocker)} onClick={() => void start()}>
              Start speed test
            </button>
            {blocker && <p className="text-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>{blocker}</p>}
          </>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>

      <div className="card" style={{ marginBottom: 20, overflowX: 'auto' }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Results</h2>
        {!detail ? (
          <p className="text-muted">Run a speed test, or pick a past one below.</p>
        ) : (
          <>
            <p className="text-muted" style={{ fontSize: 12, marginTop: -8 }}>
              {detail.summary.characterName} &amp; {detail.summary.personaName} · {detail.summary.turns} turns per model ·{' '}
              {detail.summary.scripted ? 'same lines for every model' : 'lines written by each model'} ·{' '}
              {formatWhen(detail.summary.startedAt)} · {STATUS_LABEL[detail.summary.status]}
              {detail.summary.error ? ` -- ${detail.summary.error}` : ''}
            </p>
            {ordered.length === 0 ? (
              <p className="text-muted">No model has finished yet.</p>
            ) : (
              <table className="zebra-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th title="Median time for a whole reply">Median reply</th>
                    <th title="About the slowest typical reply (90th percentile)">Slow reply</th>
                    <th title="How fast it writes: reply tokens per second of writing, from Ollama's own counters">
                      Tokens/s
                    </th>
                    <th title="How fast it reads the prompt">Prompt tok/s</th>
                    <th title="Request sent to the first words arriving">To first word</th>
                    <th title="Average reply length in tokens">Avg reply</th>
                    <th title="Time Ollama spent loading the model for the first reply">Cold load</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((r) => (
                    <tr key={r.runId}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.model}</td>
                      <td>{seconds(r.medianReplyMs)}</td>
                      <td>{seconds(r.p90ReplyMs)}</td>
                      <td>
                        <strong>{fixed(r.medianTokensPerSec, 1)}</strong>
                        {r.approximate ? '*' : ''}
                      </td>
                      <td>{fixed(r.medianPromptTokensPerSec, 0)}</td>
                      <td>{seconds(r.medianFirstTokenMs)}</td>
                      <td>{fixed(r.avgReplyTokens, 0)}</td>
                      <td>{seconds(r.coldLoadMs)}</td>
                      <td title={r.error ?? undefined}>{r.status === 'completed' ? '✓' : r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Medians over each model&apos;s replies after the first. Fastest writer first.
              {ordered.some((r) => r.approximate)
                ? ' * Ollama reported no timing counters for some replies, so this speed is output tokens over wall time and includes prompt reading.'
                : ''}
            </p>
            {selectedId && detail.summary.status !== 'running' && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn" onClick={() => void exportTest(selectedId, 'md')}>
                  Export Markdown
                </button>
                <button type="button" className="btn" onClick={() => void exportTest(selectedId, 'json')}>
                  Export JSON
                </button>
              </div>
            )}
          </>
        )}
        {notice && <p className="text-muted" style={{ fontSize: 12 }}>{notice}</p>}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Past speed tests</h2>
        {tests.length === 0 && <p className="text-muted">None yet.</p>}
        <ul className="automation-runs">
          {tests.map((test) => (
            <li
              key={test.id}
              className="automation-run"
              style={test.id === selectedId ? { borderColor: 'var(--color-accent-blue)' } : undefined}
            >
              <div className="automation-run-head">
                <span className={`automation-status automation-status-${test.status}`}>{STATUS_LABEL[test.status]}</span>
                <span className="automation-run-title">
                  {test.models.length} model{test.models.length === 1 ? '' : 's'} · {test.characterName}
                </span>
              </div>
              <div className="automation-run-meta">
                {test.finishedModels}/{test.models.length} finished · {test.turns} turns · {formatWhen(test.startedAt)}
              </div>
              {test.error && <div className="automation-run-error">{test.error}</div>}
              <div className="automation-run-actions">
                <button type="button" className="btn" onClick={() => setSelectedId(test.id)}>
                  View
                </button>
                {test.status !== 'running' &&
                  (confirmDelete && selectedId === test.id ? (
                    <>
                      <button type="button" className="btn btn-danger" onClick={() => void deleteTest(test.id)}>
                        Delete
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setSelectedId(test.id);
                        setConfirmDelete(true);
                      }}
                    >
                      Delete
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
