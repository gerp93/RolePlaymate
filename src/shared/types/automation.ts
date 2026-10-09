import { ChatDebugInfo, SamplerParams } from './chat';

/**
 * Automated runs: the app plays both sides of a conversation for a fixed number of turns (the
 * persona's line is drafted by the same "Suggest reply" path the composer uses, then sent like any
 * typed message) and keeps a full diagnostic log of what the model was actually shown. See
 * main/chat/automationRunner.ts.
 */

export type AutomationRunStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';

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
