import { Link } from 'react-router-dom';
import { ModelSpeedEntry } from '../../shared/types/automation';
import { MeasuredTier, measuredSpeedTier } from '../../shared/utils/measuredSpeed';

export const MEASURED_TIER_COLORS: Record<MeasuredTier, string> = {
  Fast: 'var(--color-accent-green, #2ecc71)',
  OK: 'var(--color-accent-blue)',
  Slow: 'var(--color-accent-red)',
};

const seconds = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(1)}s`);
const number = (value: number | null, digits: number) => (value === null ? '-' : value.toFixed(digits));

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** "measured: 74.2 tok/s" for the latest result, coloured by how usable that speed is for chat. */
export function MeasuredSpeedLine({ entry, tooOptimistic }: { entry: ModelSpeedEntry; tooOptimistic: boolean }) {
  const { result } = entry;
  if (result.medianTokensPerSec === null) return null;
  const tier = measuredSpeedTier(result.medianTokensPerSec);
  return (
    <div
      style={{ fontSize: 11, color: MEASURED_TIER_COLORS[tier] }}
      title={
        `Measured in a speed test on ${formatWhen(entry.startedAt)}: ${number(result.medianTokensPerSec, 1)} tokens/s writing, ` +
        `${seconds(result.medianReplyMs)} median reply. Reads as ${tier} for chat.` +
        (tooOptimistic ? ' The estimate above promised better than this.' : '')
      }
    >
      {tooOptimistic ? '⚠ ' : ''}measured: {number(result.medianTokensPerSec, 1)} tok/s
    </div>
  );
}

/**
 * What the expanded Model Tuning row shows: the latest speed test of this model in full, and the
 * earlier ones, each linking to the whole test.
 */
export default function ModelSpeedDetails({ entries }: { entries: ModelSpeedEntry[] }) {
  const [latest, ...earlier] = entries;
  if (!latest) return <span className="text-muted">No speed tests with this model yet.</span>;
  const r = latest.result;

  const stat = (label: string, value: string, title?: string) => (
    <div title={title} style={{ minWidth: 110 }}>
      <div className="text-muted" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: '4px 0 8px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <strong>Latest speed test</strong>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {formatWhen(latest.startedAt)} · {latest.characterName} ·{' '}
          {latest.scripted ? 'same lines for every model' : 'lines written by each model'}
        </span>
        <Link to={`/model-tuning?tab=speed&test=${latest.benchmarkId}`} style={{ fontSize: 12 }}>
          Open this test
        </Link>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
        {stat('Writing speed', `${number(r.medianTokensPerSec, 1)} tokens/s${r.approximate ? '*' : ''}`)}
        {stat('Median reply', seconds(r.medianReplyMs))}
        {stat('Slow reply', seconds(r.p90ReplyMs), 'About the slowest typical reply (90th percentile)')}
        {stat('Prompt reading', `${number(r.medianPromptTokensPerSec, 0)} tokens/s`)}
        {stat('Reply length', r.avgReplyTokens === null ? '-' : `${number(r.avgReplyTokens, 0)} tokens`)}
        {stat('Cold load', seconds(r.coldLoadMs), 'Time Ollama spent loading the model for the first reply')}
        {stat('Turns', `${r.turnsCompleted}${r.turnsRequested === null ? '' : ` of ${r.turnsRequested}`}`)}
        {stat('Result', r.status === 'completed' ? 'completed' : r.status)}
      </div>

      {earlier.length > 0 && (
        <>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
            Earlier speed tests
          </div>
          <table className="zebra-table speed-table" style={{ fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Tokens/s</th>
                <th>Median reply</th>
                <th>Prompt tok/s</th>
                <th>Reply length</th>
                <th>Turns</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {earlier.map((entry) => (
                <tr key={entry.benchmarkId}>
                  <td>{formatWhen(entry.startedAt)}</td>
                  <td>{number(entry.result.medianTokensPerSec, 1)}</td>
                  <td>{seconds(entry.result.medianReplyMs)}</td>
                  <td>{number(entry.result.medianPromptTokensPerSec, 0)}</td>
                  <td>{entry.result.avgReplyTokens === null ? '-' : `${number(entry.result.avgReplyTokens, 0)} tokens`}</td>
                  <td>
                    {entry.result.turnsCompleted}
                    {entry.result.turnsRequested === null ? '' : ` of ${entry.result.turnsRequested}`}
                  </td>
                  <td>
                    <Link to={`/model-tuning?tab=speed&test=${entry.benchmarkId}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {r.approximate && (
        <p className="text-muted" style={{ fontSize: 11, marginBottom: 0 }}>
          * Ollama reported no timing counters for some replies, so this speed includes prompt reading.
        </p>
      )}
    </div>
  );
}
