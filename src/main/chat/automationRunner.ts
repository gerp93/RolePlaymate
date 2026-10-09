import { ChatSessionManager } from './chatSession';
import { ConversationService } from '../database/conversationService';
import { ScenarioService } from '../database/scenarioService';
import { CharacterService } from '../database/characterService';
import { AutomationRunService } from '../database/automationRunService';
import { ConversationMemory } from '../../shared/types/conversationMemory';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { ChatDebugInfo } from '../../shared/types/chat';
import {
  AutomationPhase,
  AutomationProgress,
  AutomationRunStatus,
  AutomationRunSummary,
  AutomationStartRequest,
  AutomationTranscriptLine,
  AutomationTurnDebug,
  AutomationTurnLog,
  MAX_AUTOMATION_TURNS,
  MIN_AUTOMATION_TURNS,
} from '../../shared/types/automation';
import { DEFAULT_MEMORY_OPTIONS } from './memoryRetrieval';
import { DEFAULT_HISTORY_LIMIT } from './chatSession';
import { getConciseReplies, getConfiguredMemoryEmbeddingModel, getNarrationPov } from '../dbLocation';

interface ActiveRun {
  summary: AutomationRunSummary;
  conversationId: string;
  stopRequested: boolean;
  phase: AutomationPhase;
}

/** Removes the "Name:" label a model sometimes puts on a line it was told not to label. */
function cleanSuggestion(raw: string, personaName: string): string {
  const label = new RegExp(`^\\s*\\**${personaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\**\\s*:\\s*`, 'i');
  return raw.replace(label, '').trim().slice(0, FIELD_LIMITS.chatMessage);
}

/** Drops the fields `fullPrompt` already contains, so a long run's log stays a sensible size. */
function slimDebug(debug: ChatDebugInfo): AutomationTurnDebug {
  const slim: Partial<ChatDebugInfo> = { ...debug };
  delete slim.historyTurns;
  delete slim.baseSystemPrompt;
  delete slim.characterInstructions;
  delete slim.systemPrompt;
  return slim as AutomationTurnDebug;
}

/**
 * Plays both sides of a one-character conversation for a fixed number of turns, and logs what the
 * model was shown at every step.
 *
 * It deliberately adds nothing to the normal chat path. Each turn is two existing calls made from
 * here, in the main process: `suggestReply` (the composer's "Suggest reply" button) writes the
 * persona's line, then `generate` (what `chat:send` calls) sends it and stores the reply exactly as
 * a typed message would be. So the conversation is a real, ordinary one -- memories are extracted
 * and retrieved, lore fires, redo/edit/delete work on it afterwards -- and a run can be
 * stopped at any point without leaving anything the normal chat can't handle (the worst case is a
 * persona line with no reply yet, which the chat already offers a "Reply as ..." for).
 *
 * One run at a time, app-wide: the local model serves one request at a time anyway.
 */
export class AutomationRunner {
  private active: ActiveRun | null = null;

  /** Set by main.ts; pushes progress to every open window. */
  onProgress: (progress: AutomationProgress) => void = () => {};

  constructor(
    private chat: ChatSessionManager,
    private conversations: ConversationService,
    private scenarios: ScenarioService,
    private characters: CharacterService,
    private runs: AutomationRunService,
    private appVersion: string
  ) {}

  getActive(): AutomationRunSummary | null {
    return this.active?.summary ?? null;
  }

  /** The active run plus which step it is on, for a page that opens mid-run. */
  getActiveProgress(): AutomationProgress | null {
    return this.active ? { run: this.active.summary, phase: this.active.phase, transcriptChanged: false } : null;
  }

  /** True while a run owns this conversation -- the chat handlers refuse to touch it meanwhile. */
  isAutomating(conversationId: string): boolean {
    return this.active?.conversationId === conversationId;
  }

  /** Called when the extractor stores memories, so the log shows when each one appeared. */
  noteMemoriesAdded(conversationId: string, added: ConversationMemory[]): void {
    if (!this.active || this.active.conversationId !== conversationId || added.length === 0) return;
    this.runs.addMemoryEvent(this.active.summary.id, {
      afterTurn: this.active.summary.completedTurns,
      at: new Date().toISOString(),
      memories: added.map((memory) => memory.content),
    });
  }

  /**
   * Validates, records the run and starts it in the background. Returns as soon as the run row
   * exists; progress arrives through `onProgress`.
   */
  start(request: AutomationStartRequest): AutomationRunSummary {
    if (this.active) throw new Error('An automated run is already in progress.');
    if (!Number.isInteger(request.turns) || request.turns < MIN_AUTOMATION_TURNS || request.turns > MAX_AUTOMATION_TURNS) {
      throw new Error(`Turns must be a whole number from ${MIN_AUTOMATION_TURNS} to ${MAX_AUTOMATION_TURNS}.`);
    }
    if (!request.model) throw new Error('Pick a model first.');

    const conversation = this.conversations.getConversation(request.conversationId);
    if (!conversation) throw new Error('Conversation not found.');
    if (conversation.groupId || !conversation.characterId) {
      throw new Error('Automated runs support one-character conversations only.');
    }
    if (this.chat.isGenerating(conversation.id)) {
      throw new Error('A reply is being generated in this conversation. Wait for it to finish.');
    }
    const persona = this.conversations.getPersona(request.personaId);
    if (!persona) throw new Error('Pick a persona for the user side first.');
    const characterId = conversation.characterId;
    const scenario = conversation.scenarioId ? this.scenarios.getScenario(conversation.scenarioId) : null;
    const characterName = this.characters.getCharacterById(characterId)?.name;
    if (!characterName) throw new Error('Character not found.');

    const summary = this.runs.createRun({
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      characterId,
      characterName,
      personaId: persona.id,
      personaName: persona.name,
      scenarioId: scenario?.id ?? null,
      scenarioName: scenario?.name ?? null,
      model: request.model,
      requestedTurns: request.turns,
      settings: {
        appVersion: this.appVersion,
        model: request.model,
        samplers: request.samplers ?? null,
        directionsEachTurn: request.directions?.trim() || null,
        historyLimit: DEFAULT_HISTORY_LIMIT,
        memoryRetrieval: { ...DEFAULT_MEMORY_OPTIONS, embeddingModel: getConfiguredMemoryEmbeddingModel() },
        conciseReplies: getConciseReplies(),
        narrationPov: getNarrationPov(),
        personaBackground: persona.background ?? null,
        messagesAtStart: this.conversations.getMessages(conversation.id).length,
        memoriesAtStart: this.conversations.countMemories(conversation.id),
      },
    });

    this.active = { summary, conversationId: conversation.id, stopRequested: false, phase: 'idle' };
    void this.run(request, characterId, persona.name, persona.background ?? null);
    return summary;
  }

  /** Ends the run after the step in flight: a reply being generated is cancelled outright. */
  stop(): void {
    if (!this.active) return;
    this.active.stopRequested = true;
    this.chat.cancel(this.active.conversationId);
  }

  private emit(phase: AutomationPhase, transcriptChanged: boolean): void {
    if (!this.active) return;
    this.active.phase = phase;
    this.onProgress({ run: this.active.summary, phase, transcriptChanged });
  }

  private async run(
    request: AutomationStartRequest,
    characterId: string,
    personaName: string,
    personaBackground: string | null
  ): Promise<void> {
    const active = this.active!;
    const conversationId = active.conversationId;
    let status: AutomationRunStatus = 'completed';
    let error: string | null = null;

    try {
      for (let index = 1; index <= request.turns; index += 1) {
        if (active.stopRequested) {
          status = 'stopped';
          break;
        }
        const startedAt = new Date().toISOString();

        // A message already waiting for its reply (an earlier cancel, a failed turn) is answered
        // first rather than stacking a second user line on top of it.
        const last = this.conversations.getMessages(conversationId).at(-1);
        const waiting = last?.role === 'user' && last.content.trim() ? last : null;

        let rawSuggestion: string | null = null;
        if (!waiting) {
          this.emit('persona', false);
          rawSuggestion = await this.chat.suggestReply(
            conversationId,
            characterId,
            request.personaId,
            personaName,
            personaBackground,
            request.model
          );
          if (active.stopRequested) {
            status = 'stopped';
            break;
          }
          if (!cleanSuggestion(rawSuggestion, personaName)) {
            throw new Error(`The model returned an empty line for ${personaName} on turn ${index}.`);
          }
        }

        this.emit('character', false);
        const result = await this.chat.generate(
          {
            conversationId,
            characterId,
            personaId: request.personaId,
            personaName,
            personaBackground,
            userMessage: waiting ? waiting.content : cleanSuggestion(rawSuggestion!, personaName),
            replyToMessageId: waiting?.id,
            model: request.model,
            directions: request.directions?.trim() || undefined,
            samplers: request.samplers,
          },
          () => {}
        );

        const user = result.userMessage ?? waiting!;
        const turn: AutomationTurnLog = {
          index,
          startedAt,
          finishedAt: new Date().toISOString(),
          rawSuggestion,
          userMessage: { id: user.id, content: user.content },
          assistantMessage: {
            id: result.message.id,
            content: result.message.content,
            model: result.message.model,
            generationMs: result.message.generationMs,
          },
          debug: slimDebug(result.debug),
        };
        this.runs.appendTurn(active.summary.id, turn);
        active.summary = { ...active.summary, completedTurns: index };
        this.emit('idle', true);
      }
    } catch (caught) {
      if (caught instanceof Error && (caught.name === 'AbortError' || caught.name === 'TimeoutError')) {
        status = 'stopped';
      } else {
        status = active.stopRequested ? 'stopped' : 'failed';
        error = active.stopRequested ? null : (caught as Error).message;
      }
    }

    try {
      active.summary = this.runs.finishRun(
        active.summary.id,
        status,
        error,
        this.snapshotTranscript(conversationId, active.summary.characterName, active.summary.personaName),
        this.conversations.listMemories(conversationId).map((memory) => ({
          content: memory.content,
          source: memory.source,
        }))
      );
    } catch (finishError) {
      // The log row is the only thing at stake; the conversation itself is already consistent.
      console.error('Could not finalize automated run log:', finishError);
    }
    const finished = active.summary;
    this.active = null;
    this.onProgress({ run: finished, phase: 'idle', transcriptChanged: true });
  }

  private snapshotTranscript(
    conversationId: string,
    characterName: string,
    personaName: string
  ): AutomationTranscriptLine[] {
    return this.conversations
      .getMessages(conversationId)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        seq: message.seq,
        role: message.role as 'user' | 'assistant',
        speaker: message.role === 'user' ? personaName : (message.speakerName ?? characterName),
        content: message.content,
        model: message.model,
        generationMs: message.generationMs,
        directions: message.directions,
      }));
  }
}
