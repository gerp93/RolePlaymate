import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationBetween, formatDuration } from '../../shared/utils/formatDuration';
import { renderBenchmarkMarkdown, summariseModelRun } from './benchmarkStats';
import type { AutomationTurnLog, BenchmarkSummary } from '../../shared/types/automation';

test('durations read as seconds, minutes or hours', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(48_400), '48s');
  assert.equal(formatDuration(751_000), '12m 31s');
  assert.equal(formatDuration(3_900_000), '1h 05m');
  assert.equal(formatDuration(-5), '0s');
});

test('the time between two timestamps, or nothing when one is missing or backwards', () => {
  assert.equal(durationBetween('2026-10-10T05:00:00.000Z', '2026-10-10T05:12:31.000Z'), '12m 31s');
  assert.equal(durationBetween('2026-10-10T05:00:00.000Z', null), null);
  assert.equal(durationBetween(null, '2026-10-10T05:00:00.000Z'), null);
  assert.equal(durationBetween('2026-10-10T05:12:31.000Z', '2026-10-10T05:00:00.000Z'), null);
  assert.equal(durationBetween('not a date', '2026-10-10T05:00:00.000Z'), null);
});

const turn = (index: number, evalMs: number): AutomationTurnLog =>
  ({
    index,
    startedAt: '',
    finishedAt: '',
    rawSuggestion: null,
    userMessage: { id: `u${index}`, content: 'hi' },
    assistantMessage: { id: `a${index}`, content: 'x', model: 'm', generationMs: evalMs + 100 },
    debug: { outputTokens: 10, inputTokens: 100, timings: { totalMs: 0, loadMs: 0, promptEvalMs: 50, evalMs, firstTokenMs: 20 } },
  }) as unknown as AutomationTurnLog;

test("a model's whole-run time is carried into its result, and is empty while unknown", () => {
  const turns = [turn(1, 1000), turn(2, 1000), turn(3, 1000)];
  assert.equal(summariseModelRun('m', 'r', 'completed', null, turns, 751_000).runMs, 751_000);
  assert.equal(summariseModelRun('m', 'r', 'running', null, turns).runMs, null);
});

test('the Markdown report gives the total time and a run-time column', () => {
  const summary: BenchmarkSummary = {
    id: 'b',
    characterName: 'Mara',
    personaName: 'Tom',
    scenarioName: null,
    turns: 3,
    scripted: true,
    keepConversations: false,
    models: ['m'],
    finishedModels: 1,
    status: 'completed',
    error: null,
    startedAt: '2026-10-10T05:00:00.000Z',
    finishedAt: '2026-10-10T05:12:31.000Z',
  };
  const result = summariseModelRun('m', 'r', 'completed', null, [turn(1, 1000), turn(2, 1000), turn(3, 1000)], 751_000);
  const md = renderBenchmarkMarkdown({ summary, results: [result] });
  assert.match(md, /finished 2026-10-10T05:12:31\.000Z \(took 12m 31s\)/);
  assert.match(md, /\| Run time \| Status \|/);
  assert.match(md, /\| 12m 31s \| completed \|/);
});

test('each model reports how many turns it completed out of how many it was asked for', () => {
  const partial = summariseModelRun('slow', 'r1', 'skipped', null, [turn(1, 1000), turn(2, 1000)], 90_000, 35);
  assert.equal(partial.turnsCompleted, 2);
  assert.equal(partial.turnsRequested, 35);
  const unknown = summariseModelRun('x', 'r2', 'completed', null, [turn(1, 1000)]);
  assert.equal(unknown.turnsRequested, null, 'requested turns are only known when the caller says');
});

test('the Markdown report shows turns per model, and marks a skipped one', () => {
  const summary: BenchmarkSummary = {
    id: 'b',
    characterName: 'Mara',
    personaName: 'Tom',
    scenarioName: null,
    turns: 35,
    scripted: true,
    keepConversations: false,
    models: ['slow', 'quick'],
    finishedModels: 2,
    status: 'completed',
    error: null,
    startedAt: '2026-10-10T05:00:00.000Z',
    finishedAt: '2026-10-10T05:30:00.000Z',
  };
  const all = [turn(1, 1000), turn(2, 1000), turn(3, 1000)];
  const results = [
    summariseModelRun('slow', 'r1', 'skipped', null, all.slice(0, 2), 60_000, 35),
    summariseModelRun('quick', 'r2', 'completed', null, all, 120_000, 35),
  ];
  const md = renderBenchmarkMarkdown({ summary, results });
  assert.match(md, /\| Model \| Turns \| Replies timed \|/);
  assert.match(md, /\| slow \| 2 of 35 \|/);
  assert.match(md, /\| quick \| 3 of 35 \|/);
  assert.match(md, /\| skipped \|/);
});
