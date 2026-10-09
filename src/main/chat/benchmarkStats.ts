import {
  AutomationRunStatus,
  AutomationTurnLog,
  BenchmarkDetail,
  BenchmarkModelResult,
} from '../../shared/types/automation';

/** Medians need enough replies to mean something; with fewer than this nothing is left out as warm-up. */
const MIN_TURNS_TO_DROP_WARMUP = 3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Nearest-rank percentile; for a handful of replies this is "about the slowest typical one". */
export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * One model's figures from its run's per-turn logs.
 *
 * The first reply is dropped (when there are enough) because it carries the model loading into
 * memory; that cost is reported separately as `coldLoadMs`. Speeds use Ollama's own counters --
 * tokens written over time spent writing, tokens read over time spent reading -- because wall time
 * per reply mostly measures how long the reply happened to be. Only when a turn has no counters
 * does the speed fall back to output tokens over wall time, and the result is flagged approximate.
 */
export function summariseModelRun(
  model: string,
  runId: string,
  status: AutomationRunStatus,
  error: string | null,
  turns: AutomationTurnLog[]
): BenchmarkModelResult {
  const measured = turns.length >= MIN_TURNS_TO_DROP_WARMUP ? turns.slice(1) : turns;

  const replyMs: number[] = [];
  const tokensPerSec: number[] = [];
  const promptTokensPerSec: number[] = [];
  const firstTokenMs: number[] = [];
  const replyTokens: number[] = [];
  let approximate = false;

  for (const turn of measured) {
    const wall = turn.assistantMessage.generationMs;
    if (positive(wall)) replyMs.push(wall);

    const timings = turn.debug.timings;
    const out = turn.debug.outputTokens;
    if (positive(out)) replyTokens.push(out);

    if (positive(out) && positive(timings?.evalMs)) {
      tokensPerSec.push(out / (timings.evalMs / 1000));
    } else if (positive(out) && positive(wall)) {
      tokensPerSec.push(out / (wall / 1000));
      approximate = true;
    }

    const input = turn.debug.inputTokens;
    if (positive(input) && positive(timings?.promptEvalMs)) {
      promptTokensPerSec.push(input / (timings.promptEvalMs / 1000));
    }
    if (positive(timings?.firstTokenMs)) firstTokenMs.push(timings.firstTokenMs);
  }

  const cold = turns[0]?.debug.timings?.loadMs;

  return {
    model,
    runId,
    status,
    error,
    repliesMeasured: measured.length,
    medianReplyMs: median(replyMs),
    p90ReplyMs: percentile(replyMs, 0.9),
    medianTokensPerSec: median(tokensPerSec),
    medianPromptTokensPerSec: median(promptTokensPerSec),
    medianFirstTokenMs: median(firstTokenMs),
    avgReplyTokens: mean(replyTokens),
    // Under a second is "was already loaded", not a load worth reporting.
    coldLoadMs: positive(cold) && cold >= 1000 ? cold : null,
    approximate,
  };
}

const fixed = (value: number | null, digits: number, unit = ''): string =>
  value === null ? '-' : `${value.toFixed(digits)}${unit}`;
const seconds = (ms: number | null): string => (ms === null ? '-' : `${(ms / 1000).toFixed(1)}s`);

/** The comparison as a Markdown table, fastest writer first, for pasting into a conversation. */
export function renderBenchmarkMarkdown(detail: BenchmarkDetail): string {
  const { summary, results } = detail;
  const out: string[] = [];
  out.push(`# Speed test: ${summary.characterName} and ${summary.personaName}`);
  out.push('');
  out.push(`- Status: **${summary.status}**${summary.error ? ` -- ${summary.error}` : ''}`);
  out.push(`- Started: ${summary.startedAt}${summary.finishedAt ? `, finished ${summary.finishedAt}` : ''}`);
  out.push(`- ${summary.turns} turns per model${summary.scenarioName ? `, scenario "${summary.scenarioName}"` : ''}`);
  out.push(
    summary.scripted
      ? '- User lines: the same generic lines for every model'
      : '- User lines: written by each model for the persona'
  );
  out.push('');
  out.push(
    'Medians over replies after the first (which carries the model load). Tokens/s is reply-writing speed, prompt tok/s is prompt-reading speed.'
  );
  out.push('');
  out.push('| Model | Replies | Median reply | Slow reply (p90) | Tokens/s | Prompt tok/s | To first word | Avg reply tokens | Cold load | Status |');
  out.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  const ordered = [...results].sort((a, b) => (b.medianTokensPerSec ?? -1) - (a.medianTokensPerSec ?? -1));
  for (const r of ordered) {
    out.push(
      `| ${r.model} | ${r.repliesMeasured} | ${seconds(r.medianReplyMs)} | ${seconds(r.p90ReplyMs)} | ` +
        `${fixed(r.medianTokensPerSec, 1)}${r.approximate ? '*' : ''} | ${fixed(r.medianPromptTokensPerSec, 0)} | ` +
        `${seconds(r.medianFirstTokenMs)} | ${fixed(r.avgReplyTokens, 0)} | ${seconds(r.coldLoadMs)} | ` +
        `${r.status}${r.error ? ` (${r.error})` : ''} |`
    );
  }
  if (results.some((r) => r.approximate)) {
    out.push('');
    out.push('\\* Ollama reported no timing counters for some replies, so this speed is output tokens over wall time and includes prompt reading.');
  }
  out.push('');
  return out.join('\n');
}
