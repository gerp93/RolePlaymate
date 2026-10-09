import type { DatabaseSync } from './sqlite';
import { v4 as uuidv4 } from 'uuid';
import {
  BenchmarkStatus,
  BenchmarkSummary,
  AutomationMemoryEvent,
  AutomationRunLog,
  AutomationRunStatus,
  AutomationRunSummary,
  AutomationStoredMemory,
  AutomationTranscriptLine,
  AutomationTurnLog,
} from '../../shared/types/automation';

const SUMMARY_COLUMNS = `
  r.id as id,
  r.conversation_id as conversationId,
  r.conversation_title as conversationTitle,
  r.character_name as characterName,
  r.persona_name as personaName,
  r.scenario_name as scenarioName,
  r.model as model,
  r.requested_turns as requestedTurns,
  r.completed_turns as completedTurns,
  r.status as status,
  r.error as error,
  r.started_at as startedAt,
  r.finished_at as finishedAt
`;

function rowToSummary(row: Record<string, unknown>): AutomationRunSummary {
  return {
    id: row.id as string,
    conversationId: (row.conversationId as string | null) ?? null,
    conversationTitle: row.conversationTitle as string,
    characterName: row.characterName as string,
    personaName: row.personaName as string,
    scenarioName: (row.scenarioName as string | null) ?? null,
    model: row.model as string,
    requestedTurns: row.requestedTurns as number,
    completedTurns: row.completedTurns as number,
    status: row.status as AutomationRunStatus,
    error: (row.error as string | null) ?? null,
    startedAt: row.startedAt as string,
    finishedAt: (row.finishedAt as string | null) ?? null,
  };
}

export interface CreateAutomationRunInput {
  conversationId: string;
  conversationTitle: string;
  characterId: string;
  characterName: string;
  personaId: string;
  personaName: string;
  scenarioId: string | null;
  scenarioName: string | null;
  model: string;
  requestedTurns: number;
  settings: Record<string, unknown>;
  /** Set for a run that belongs to a speed test. */
  benchmarkId?: string | null;
}

/** SQL conditions that leave out rows whose character, persona or scenario is hidden. Used while
 * the hidden-items PIN is locked: a log holds conversation text the privacy screen keeps off screen. */
function hiddenConditions(alias: string): string[] {
  return [
    `NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = ${alias}.character_id AND c.is_hidden = 1)`,
    `NOT EXISTS (SELECT 1 FROM user_personas p WHERE p.id = ${alias}.persona_id AND p.is_hidden = 1)`,
    `NOT EXISTS (SELECT 1 FROM scenarios s WHERE s.id = ${alias}.scenario_id AND s.is_hidden = 1)`,
  ];
}

/**
 * Storage for automated-run logs -- see main/chat/automationRunner.ts and the schema note on
 * `automation_runs`. Turns are appended one row at a time as they finish, so a crash or a
 * force-quit mid-run still leaves everything up to the last completed turn.
 */
export class AutomationRunService {
  constructor(private db: DatabaseSync) {}

  createRun(input: CreateAutomationRunInput): AutomationRunSummary {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO automation_runs (
           id, conversation_id, conversation_title, character_id, character_name, persona_id, persona_name,
           scenario_id, scenario_name, model, requested_turns, completed_turns, status, settings, started_at, benchmark_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'running', ?, ?, ?)`
      )
      .run(
        id,
        input.conversationId,
        input.conversationTitle,
        input.characterId,
        input.characterName,
        input.personaId,
        input.personaName,
        input.scenarioId,
        input.scenarioName,
        input.model,
        input.requestedTurns,
        JSON.stringify(input.settings),
        now,
        input.benchmarkId ?? null
      );
    return this.getSummary(id)!;
  }

  getSummary(id: string): AutomationRunSummary | null {
    const row = this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM automation_runs r WHERE r.id = ?`).get(id);
    return row ? rowToSummary(row) : null;
  }

  appendTurn(runId: string, turn: AutomationTurnLog): void {
    this.db
      .prepare(`INSERT INTO automation_run_turns (id, run_id, turn_index, data, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(uuidv4(), runId, turn.index, JSON.stringify(turn), new Date().toISOString());
    this.db.prepare(`UPDATE automation_runs SET completed_turns = ? WHERE id = ?`).run(turn.index, runId);
  }

  addMemoryEvent(runId: string, event: AutomationMemoryEvent): void {
    const row = this.db.prepare(`SELECT memory_events AS events FROM automation_runs WHERE id = ?`).get(runId) as
      | { events: string }
      | undefined;
    if (!row) return;
    const events = JSON.parse(row.events) as AutomationMemoryEvent[];
    events.push(event);
    this.db.prepare(`UPDATE automation_runs SET memory_events = ? WHERE id = ?`).run(JSON.stringify(events), runId);
  }

  finishRun(
    runId: string,
    status: AutomationRunStatus,
    error: string | null,
    transcript: AutomationTranscriptLine[],
    memories: AutomationStoredMemory[]
  ): AutomationRunSummary {
    this.db
      .prepare(
        `UPDATE automation_runs SET status = ?, error = ?, transcript = ?, final_memories = ?, finished_at = ? WHERE id = ?`
      )
      .run(status, error, JSON.stringify(transcript), JSON.stringify(memories), new Date().toISOString(), runId);
    return this.getSummary(runId)!;
  }

  /** A run still marked running when the app starts was cut off (crash, force-quit). */
  markStaleRunsInterrupted(): void {
    this.db
      .prepare(
        `UPDATE automation_runs SET status = 'interrupted', finished_at = ?, error = 'The app closed before this run finished.' WHERE status = 'running'`
      )
      .run(new Date().toISOString());
  }

  /**
   * Newest first. While the hidden-items PIN is locked, runs of a hidden character, persona or
   * scenario are left out -- the log holds their conversation text, which the privacy screen
   * exists to keep off screen.
   */
  listRuns(includeHidden: boolean, limit = 50): AutomationRunSummary[] {
    // Speed-test runs have their own list; one test would otherwise add a row per model here.
    const conditions = ['r.benchmark_id IS NULL'];
    if (!includeHidden) conditions.push(...hiddenConditions('r'));
    return this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM automation_runs r WHERE ${conditions.join(' AND ')} ORDER BY r.started_at DESC LIMIT ?`
      )
      .all(limit)
      .map(rowToSummary);
  }

  /** Whether the run may be shown right now -- same rule as listRuns, for a single id. */
  isVisible(runId: string, includeHidden: boolean): boolean {
    return this.listRuns(includeHidden, 1000).some((run) => run.id === runId);
  }

  getLog(runId: string): AutomationRunLog | null {
    const summary = this.getSummary(runId);
    if (!summary) return null;
    const row = this.db
      .prepare(
        `SELECT settings, memory_events AS memoryEvents, transcript, final_memories AS finalMemories FROM automation_runs WHERE id = ?`
      )
      .get(runId) as { settings: string; memoryEvents: string; transcript: string | null; finalMemories: string | null };
    const turns = (
      this.db
        .prepare(`SELECT data FROM automation_run_turns WHERE run_id = ? ORDER BY turn_index`)
        .all(runId) as { data: string }[]
    ).map((turn) => JSON.parse(turn.data) as AutomationTurnLog);

    return {
      formatVersion: 1,
      run: summary,
      settings: JSON.parse(row.settings),
      transcript: row.transcript ? (JSON.parse(row.transcript) as AutomationTranscriptLine[]) : [],
      turns,
      memoryEvents: JSON.parse(row.memoryEvents) as AutomationMemoryEvent[],
      memoriesAtEnd: row.finalMemories ? (JSON.parse(row.finalMemories) as AutomationStoredMemory[]) : [],
    };
  }

  deleteRun(runId: string): void {
    this.db.prepare(`DELETE FROM automation_runs WHERE id = ?`).run(runId);
  }

  // --- Speed tests ---------------------------------------------------------------------------

  createBenchmark(input: {
    characterId: string;
    characterName: string;
    personaId: string;
    personaName: string;
    scenarioId: string | null;
    scenarioName: string | null;
    turns: number;
    scripted: boolean;
    keepConversations: boolean;
    models: string[];
  }): BenchmarkSummary {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO automation_benchmarks (
           id, character_id, character_name, persona_id, persona_name, scenario_id, scenario_name,
           turns, scripted, keep_conversations, models, status, started_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`
      )
      .run(
        id,
        input.characterId,
        input.characterName,
        input.personaId,
        input.personaName,
        input.scenarioId,
        input.scenarioName,
        input.turns,
        input.scripted ? 1 : 0,
        input.keepConversations ? 1 : 0,
        JSON.stringify(input.models),
        new Date().toISOString()
      );
    return this.getBenchmarkSummary(id)!;
  }

  private static readonly BENCHMARK_COLUMNS = `
    b.id as id, b.character_name as characterName, b.persona_name as personaName,
    b.scenario_name as scenarioName, b.turns as turns, b.scripted as scripted,
    b.keep_conversations as keepConversations, b.models as models, b.status as status,
    b.error as error, b.started_at as startedAt, b.finished_at as finishedAt,
    (SELECT count(*) FROM automation_runs r WHERE r.benchmark_id = b.id AND r.status != 'running') as finishedModels
  `;

  private rowToBenchmark(row: Record<string, unknown>): BenchmarkSummary {
    return {
      id: row.id as string,
      characterName: row.characterName as string,
      personaName: row.personaName as string,
      scenarioName: (row.scenarioName as string | null) ?? null,
      turns: row.turns as number,
      scripted: !!row.scripted,
      keepConversations: !!row.keepConversations,
      models: JSON.parse(row.models as string) as string[],
      finishedModels: Number(row.finishedModels ?? 0),
      status: row.status as BenchmarkStatus,
      error: (row.error as string | null) ?? null,
      startedAt: row.startedAt as string,
      finishedAt: (row.finishedAt as string | null) ?? null,
    };
  }

  getBenchmarkSummary(id: string): BenchmarkSummary | null {
    const row = this.db
      .prepare(`SELECT ${AutomationRunService.BENCHMARK_COLUMNS} FROM automation_benchmarks b WHERE b.id = ?`)
      .get(id);
    return row ? this.rowToBenchmark(row) : null;
  }

  finishBenchmark(id: string, status: BenchmarkStatus, error: string | null): BenchmarkSummary {
    this.db
      .prepare(`UPDATE automation_benchmarks SET status = ?, error = ?, finished_at = ? WHERE id = ?`)
      .run(status, error, new Date().toISOString(), id);
    return this.getBenchmarkSummary(id)!;
  }

  /** Newest first; a hidden character, persona or scenario hides its tests while the PIN is locked. */
  listBenchmarks(includeHidden: boolean, limit = 30): BenchmarkSummary[] {
    const where = includeHidden ? '' : `WHERE ${hiddenConditions('b').join(' AND ')}`;
    return this.db
      .prepare(
        `SELECT ${AutomationRunService.BENCHMARK_COLUMNS} FROM automation_benchmarks b ${where} ORDER BY b.started_at DESC LIMIT ?`
      )
      .all(limit)
      .map((row) => this.rowToBenchmark(row));
  }

  /** The runs of one test, in the order the models were given. */
  getBenchmarkRuns(benchmarkId: string): { summary: AutomationRunSummary; turns: AutomationTurnLog[] }[] {
    const summaries = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM automation_runs r WHERE r.benchmark_id = ? ORDER BY r.started_at`)
      .all(benchmarkId)
      .map(rowToSummary);
    return summaries.map((summary) => ({
      summary,
      turns: (
        this.db
          .prepare(`SELECT data FROM automation_run_turns WHERE run_id = ? ORDER BY turn_index`)
          .all(summary.id) as { data: string }[]
      ).map((turn) => JSON.parse(turn.data) as AutomationTurnLog),
    }));
  }

  /** A test still marked running when the app starts was cut off. */
  markStaleBenchmarksInterrupted(): void {
    this.db
      .prepare(
        `UPDATE automation_benchmarks SET status = 'interrupted', finished_at = ?, error = 'The app closed before this test finished.' WHERE status = 'running'`
      )
      .run(new Date().toISOString());
  }

  deleteBenchmark(id: string): void {
    this.db.prepare(`DELETE FROM automation_runs WHERE benchmark_id = ?`).run(id);
    this.db.prepare(`DELETE FROM automation_benchmarks WHERE id = ?`).run(id);
  }
}
