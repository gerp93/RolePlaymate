import { ChatDebugInfo, SamplerParams } from './chat';

/**
 * Automated runs: the app plays both sides of a conversation for a fixed number of turns (the
 * persona's line is drafted by the same "Suggest reply" path the composer uses, then sent like any
 * typed message) and keeps a full diagnostic log of what the model was actually shown. See
 * main/chat/automationRunner.ts.
 */

/** 'skipped': a speed-test model the user moved past before it finished; what it had completed is kept. */
export type AutomationRunStatus = 'running' | 'completed' | 'stopped' | 'skipped' | 'failed' | 'interrupted';

export const MIN_AUTOMATION_TURNS = 1;
export const MAX_AUTOMATION_TURNS = 100;

export interface AutomationStartRequest {
  conversationId: string;
  /** Who replies. One-character conversations only. */
  characterId: string;
  personaId: string;
  model: string;
  /** Persona line + character reply = one turn. */
  turns: number;
  /** Optional standing per-turn directions, applied to every character reply in the run. */
  directions?: string;
  /** Optional: what the persona is steering toward in every line the model writes for them. */
  personaDirections?: string;
  /** Optional: a different model to write the persona's lines (default: the same model as the
   * character). A roleplay model writes poor persona lines -- fragments, mixed person, walking off
   * alone -- and the character copies them. A second large model that does not fit beside the first
   * makes Ollama swap models every turn. */
  personaModel?: string;
  /** Send the generic scripted lines instead of drafting the persona's side, so only the character's
   * behaviour is being tested. */
  scriptedPersona?: boolean;
  samplers?: Partial<SamplerParams>;
}

/** One row of the run list -- everything except the per-turn detail. */
export interface AutomationRunSummary {
  id: string;
  conversationId: string | null;
  conversationTitle: string;
  characterName: string;
  personaName: string;
  scenarioName: string | null;
  model: string;
  requestedTurns: number;
  completedTurns: number;
  status: AutomationRunStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type AutomationPhase = 'persona' | 'character' | 'idle';

/** Pushed on `automation:progress` after every step, so the chat page can reload what the run
 * just wrote and show live status. */
export interface AutomationProgress {
  run: AutomationRunSummary;
  phase: AutomationPhase;
  /** True when the transcript changed since the last event (a turn finished or the run ended). */
  transcriptChanged: boolean;
}

/** Logged for each turn, as the model actually saw it. The bulky duplicates inside ChatDebugInfo
 * (history, base prompt) are dropped -- `fullPrompt` already contains them. */
export type AutomationTurnDebug = Omit<
  ChatDebugInfo,
  'historyTurns' | 'baseSystemPrompt' | 'characterInstructions' | 'systemPrompt'
> & {
  /** Kept on the first turn only (see slimDebug in automationRunner.ts). */
  systemPrompt?: string;
};

export interface AutomationTurnLog {
  index: number;
  startedAt: string;
  finishedAt: string;
  /** What the persona-drafting call returned, before cleanup. Null when this turn answered a
   * message that was already waiting for a reply. */
  rawSuggestion: string | null;
  /** The persona's line as sent. */
  userMessage: { id: string; content: string };
  assistantMessage: { id: string; content: string; model: string | null; generationMs: number | null };
  /** How many times the persona's line / the character's reply was redone because it nearly
   * repeated something recent. Absent in logs from before the repetition guard. */
  repeatRetries?: { persona: number; character: number };
  /** The reply was redone this many times because it fell back on wording the character had overused. */
  stockPhraseRetries?: number;
  /** Overused wording the final reply still used after any redos. */
  stockPhraseHits?: string[];
  /** True when it still repeated after the retries. */
  stillRepeating?: boolean;
  debug: AutomationTurnDebug;
}

export interface AutomationMemoryEvent {
  /** How many turns had completed when the extractor stored these. */
  afterTurn: number;
  at: string;
  memories: string[];
}

export interface AutomationTranscriptLine {
  seq: number;
  role: 'user' | 'assistant';
  speaker: string;
  content: string;
  model: string | null;
  generationMs: number | null;
  directions: string | null;
}

export interface AutomationStoredMemory {
  content: string;
  source: string;
}

/** The complete log, as exported. */
export interface AutomationRunLog {
  formatVersion: 1;
  run: AutomationRunSummary;
  settings: Record<string, unknown>;
  transcript: AutomationTranscriptLine[];
  turns: AutomationTurnLog[];
  memoryEvents: AutomationMemoryEvent[];
  memoriesAtEnd: AutomationStoredMemory[];
}

export type AutomationExportFormat = 'json' | 'md';

// --- Speed tests (benchmarks) --------------------------------------------------------------------

export const MIN_BENCHMARK_TURNS = 3;
export const MAX_BENCHMARK_TURNS = 50;
export const MAX_BENCHMARK_MODELS = 30;

export interface BenchmarkStartRequest {
  characterId: string;
  personaId: string;
  /** One of the character's scenarios, or none. */
  scenarioId?: string | null;
  /** Every model gets its own fresh conversation and run, one after another. */
  models: string[];
  turns: number;
  /** Send the same generic lines to every model instead of letting each write its own persona side. */
  scripted: boolean;
  /** Keep each model's test conversation. Off deletes it once its run finishes; the results stay. */
  keepConversations: boolean;
  samplers?: Partial<SamplerParams>;
}

export type BenchmarkStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';

export interface BenchmarkSummary {
  id: string;
  characterName: string;
  personaName: string;
  scenarioName: string | null;
  turns: number;
  scripted: boolean;
  keepConversations: boolean;
  models: string[];
  /** How many of `models` have finished (successfully or not). */
  finishedModels: number;
  status: BenchmarkStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** One model's figures. Medians, because one slow reply (a background app, a thermal blip) should not
 * decide a comparison. Timings exclude the first reply, which carries the cost of loading the model. */
export interface BenchmarkModelResult {
  model: string;
  runId: string;
  status: AutomationRunStatus;
  error: string | null;
  /** How many of this model's turns were completed, out of how many it was asked for -- per model, because a
   * skipped or stopped model has fewer than the test's setting. */
  turnsCompleted: number;
  turnsRequested: number | null;
  /** Replies the figures are based on (the first is left out as a warm-up when there are enough). */
  repliesMeasured: number;
  medianReplyMs: number | null;
  p90ReplyMs: number | null;
  /** Reply-writing speed, from Ollama's own counters where reported. */
  medianTokensPerSec: number | null;
  /** Prompt-reading speed. */
  medianPromptTokensPerSec: number | null;
  /** Request sent to first words back. */
  medianFirstTokenMs: number | null;
  avgReplyTokens: number | null;
  /** Time Ollama spent loading the model for the first reply; null if it was already loaded or unreported. */
  coldLoadMs: number | null;
  /** True when the speed figures fell back to wall time (Ollama reported no counters). */
  approximate: boolean;
  /** How long this model's whole run took, start to finish (includes loading it and anything else the
   * app did around the replies). Null while it is still running. */
  runMs: number | null;
}

export interface BenchmarkDetail {
  summary: BenchmarkSummary;
  results: BenchmarkModelResult[];
}

/** Pushed on `benchmark:progress` after every step. */
export interface BenchmarkProgress {
  benchmark: BenchmarkSummary;
  /** The model being run now, and how far through its turns. Null between models and at the end. */
  model: string | null;
  completedTurns: number;
  requestedTurns: number;
}

/** One model's result in one speed test, with enough about the test to place it in a history. */
export interface ModelSpeedEntry {
  benchmarkId: string;
  startedAt: string;
  characterName: string;
  scripted: boolean;
  result: BenchmarkModelResult;
}

/** Model tag -> its results in speed tests, newest first. */
export type ModelSpeedHistory = Record<string, ModelSpeedEntry[]>;
