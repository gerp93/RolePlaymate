import { ChatSessionManager } from './chatSession';
import { ConversationService } from '../database/conversationService';
import { Conversation, CreateConversationInput } from '../../shared/types/conversation';
import { ScenarioService } from '../database/scenarioService';
import { CharacterService } from '../database/characterService';
import { AutomationRunService } from '../database/automationRunService';
import { ConversationMemory } from '../../shared/types/conversationMemory';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { ChatDebugInfo } from '../../shared/types/chat';
import {
  BenchmarkProgress,
  BenchmarkStartRequest,
  BenchmarkSummary,
  MAX_BENCHMARK_MODELS,
  MAX_BENCHMARK_TURNS,
  MIN_BENCHMARK_TURNS,
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
import { textSimilarity } from './memoryExtraction';
import { DEFAULT_HISTORY_LIMIT } from './chatSession';
import { getConciseReplies, getConfiguredMemoryEmbeddingModel, getNarrationPov } from '../dbLocation';

interface ActiveBenchmark {
  summary: BenchmarkSummary;
  stopRequested: boolean;
  model: string | null;
}

/** What only a speed test sets; an ordinary run leaves all of it off. */
interface RunOptions {
  benchmarkId?: string;
  /** Send SCRIPTED_LINES instead of having the model write the persona's side. */
  scripted?: boolean;
  /** Redo near-repeats. Off for a speed test: a redo would double a reply's time. */
  repeatGuard?: boolean;
}

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

/** Drops the fields `fullPrompt` already contains, so a long run's log stays a sensible size. The
 * first turn keeps its system prompt: with no memories yet it is the character card, scenario and
 * rules exactly as the model was given them, which the exports show once up front. */
function slimDebug(debug: ChatDebugInfo, keepSystemPrompt: boolean): AutomationTurnDebug {
  const slim: Partial<ChatDebugInfo> = { ...debug };
  delete slim.historyTurns;
  delete slim.baseSystemPrompt;
  delete slim.characterInstructions;
  if (!keepSystemPrompt) delete slim.systemPrompt;
  return slim as AutomationTurnDebug;
}

/**
 * The user side of a speed test: generic lines that read sensibly after almost any reply, so the
 * conversation stays coherent whatever each model says, while every model is sent exactly the same
 * words in the same order. Speed depends on how many tokens go in and come out, not on the story,
 * so this is what lets models be compared; a scene written by each model would differ per model.
 */
export const SCRIPTED_LINES = [
  "Go on, I'm listening.",
  'Tell me more about that.',
  'Why do you say that?',
  "That's interesting. What happens next?",
  "I'm not sure I follow. Can you explain it a little more?",
  'How did you come to know that?',
  'And what would you do if you were in my place?',
  "Is there something you aren't telling me?",
  'Let us take a moment. What do you notice around us?',
  'What do you want most right now?',
  "That sounds risky. Are you sure about this?",
  'Okay. Walk me through it, one step at a time.',
  "I trust you. What's the plan?",
  'Tell me something about your past. I would like to understand you better.',
  'What are you most afraid of?',
  'Let us try something different. What else could we do?',
  'That surprises me. Say more.',
  'How long have you known?',
  'What do you think I should do next?',
  'I need a moment to take that in. Give me your honest view.',
  'Is it as bad as it sounds?',
  'Who else knows about this?',
  'Then we should decide what matters most. What is it for you?',
  'Alright. Show me what you mean.',
];

/** How much of the recent transcript a new line is compared against, how alike counts as a
 * repeat (word-set overlap), and how many redrafts / consecutive failures are tolerated. */
const REPEAT_WINDOW = 6;
const REPEAT_SIMILARITY = 0.8;
const MAX_REPEAT_RETRIES = 2;
const MAX_REPEAT_STRIKES = 3;
/** Very short lines ("Okay.") overlap trivially and are not worth redrafting over. */
const REPEAT_MIN_WORDS = 6;

function isRepeat(text: string, recent: string[]): boolean {
  if (text.split(/\s+/).filter(Boolean).length < REPEAT_MIN_WORDS) return false;
  return recent.some((earlier) => textSimilarity(text, earlier) >= REPEAT_SIMILARITY);
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
  /** Settles when the run now in `active` has fully finished -- what a speed test waits on. */
  private runFinished: Promise<void> = Promise.resolve();
  private benchmark: ActiveBenchmark | null = null;

  /** Set by main.ts; pushes speed-test progress to every open window. */
  onBenchmarkProgress: (progress: BenchmarkProgress) => void = () => {};
  /** Set by main.ts: creates a conversation with its scenario greeting, like the chat's own start. */
  createConversation: (input: CreateConversationInput) => Conversation = () => {
    throw new Error('Conversation creation is not wired up');
  };

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
  start(request: AutomationStartRequest, options: RunOptions = {}): AutomationRunSummary {
    if (this.active) throw new Error('An automated run is already in progress.');
    if (this.benchmark && !options.benchmarkId) throw new Error('A speed test is in progress.');
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
      benchmarkId: options.benchmarkId ?? null,
      settings: {
        appVersion: this.appVersion,
        model: request.model,
        samplers: request.samplers ?? null,
        directionsEachTurn: request.directions?.trim() || null,
        personaDirections: request.personaDirections?.trim() || null,
        scriptedPersonaLines: Boolean(options.scripted),
        repeatGuard: options.repeatGuard !== false,
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
    this.runFinished = this.run(request, characterId, persona.name, persona.background ?? null, options);
    return summary;
  }

  /** Ends the run after the step in flight: a reply being generated is cancelled outright. */
  stop(): void {
    if (!this.active) return;
    this.active.stopRequested = true;
    this.chat.cancel(this.active.conversationId);
  }

  // --- Speed tests ---------------------------------------------------------------------------

  getActiveBenchmark(): BenchmarkProgress | null {
    if (!this.benchmark) return null;
    return {
      benchmark: this.benchmark.summary,
      model: this.benchmark.model,
      completedTurns: this.active?.summary.completedTurns ?? 0,
      requestedTurns: this.benchmark.summary.turns,
    };
  }

  /**
   * Starts a speed test: the same short automated chat, once per model, one after another. Each
   * model gets a fresh conversation (so it never inherits another model's context) and is unloaded
   * from Ollama afterwards, so the next one is timed from a cold start with the GPU to itself. The
   * test conversations are deleted as each run finishes unless asked to keep them; the run logs
   * and the results stay either way.
   */
  startBenchmark(request: BenchmarkStartRequest): BenchmarkSummary {
    if (this.active || this.benchmark) throw new Error('An automated run or speed test is already in progress.');
    if (!Number.isInteger(request.turns) || request.turns < MIN_BENCHMARK_TURNS || request.turns > MAX_BENCHMARK_TURNS) {
      throw new Error(`Turns must be a whole number from ${MIN_BENCHMARK_TURNS} to ${MAX_BENCHMARK_TURNS}.`);
    }
    const models = [...new Set(request.models.map((model) => model.trim()).filter(Boolean))];
    if (models.length === 0) throw new Error('Pick at least one model to test.');
    if (models.length > MAX_BENCHMARK_MODELS) throw new Error(`Pick at most ${MAX_BENCHMARK_MODELS} models.`);

    const character = this.characters.getCharacterById(request.characterId);
    if (!character) throw new Error('Pick a character first.');
    const persona = this.conversations.getPersona(request.personaId);
    if (!persona) throw new Error('Pick a persona first.');
    const scenario = request.scenarioId ? this.scenarios.getScenario(request.scenarioId) : null;

    const summary = this.runs.createBenchmark({
      characterId: character.id,
      characterName: character.name,
      personaId: persona.id,
      personaName: persona.name,
      scenarioId: scenario?.id ?? null,
      scenarioName: scenario?.name ?? null,
      turns: request.turns,
      scripted: request.scripted,
      keepConversations: request.keepConversations,
      models,
    });
    this.benchmark = { summary, stopRequested: false, model: null };
    void this.runBenchmark(request, models, character.id, persona.id, scenario?.id ?? null);
    return summary;
  }

  /** Ends the test after the reply in flight; models not yet reached are not run. */
  stopBenchmark(): void {
    if (!this.benchmark) return;
    this.benchmark.stopRequested = true;
    this.stop();
  }

  private emitBenchmark(): void {
    const progress = this.getActiveBenchmark();
    if (progress) this.onBenchmarkProgress(progress);
  }

  private async runBenchmark(
    request: BenchmarkStartRequest,
    models: string[],
    characterId: string,
    personaId: string,
    scenarioId: string | null
  ): Promise<void> {
    const benchmark = this.benchmark!;
    let status: BenchmarkSummary['status'] = 'completed';
    let error: string | null = null;

    try {
      for (const model of models) {
        if (benchmark.stopRequested) {
          status = 'stopped';
          break;
        }
        benchmark.model = model;
        let conversationId: string | null = null;
        try {
          const conversation = this.createConversation({
            characterId,
            userPersonaId: personaId,
            scenarioId: scenarioId ?? undefined,
            model,
            title: `Speed test: ${model}`,
          });
          conversationId = conversation.id;
          this.start(
            {
              conversationId,
              characterId,
              personaId,
              model,
              turns: request.turns,
              samplers: request.samplers,
            },
            { benchmarkId: benchmark.summary.id, scripted: request.scripted, repeatGuard: false }
          );
          this.emitBenchmark();
          await this.runFinished;
        } finally {
          // The run row is final by now. Drop the test conversation unless asked to keep it.
          if (conversationId && !request.keepConversations) {
            try {
              this.chat.dropSession(conversationId);
              this.conversations.deleteConversation(conversationId);
            } catch (cleanupError) {
              console.error('Could not delete a speed-test conversation:', cleanupError);
            }
          }
          // Free the GPU so the next model is timed from a cold start.
          await this.chat.unloadModel(model);
          benchmark.summary = this.runs.getBenchmarkSummary(benchmark.summary.id) ?? benchmark.summary;
        }
      }
    } catch (caught) {
      status = benchmark.stopRequested ? 'stopped' : 'failed';
      error = benchmark.stopRequested ? null : (caught as Error).message;
    }

    benchmark.model = null;
    const finished = this.runs.finishBenchmark(benchmark.summary.id, status, error);
    benchmark.summary = finished;
    this.onBenchmarkProgress({ benchmark: finished, model: null, completedTurns: 0, requestedTurns: finished.turns });
    this.benchmark = null;
  }

  private emit(phase: AutomationPhase, transcriptChanged: boolean): void {
    if (!this.active) return;
    this.active.phase = phase;
    this.onProgress({ run: this.active.summary, phase, transcriptChanged });
    this.emitBenchmark();
  }

  private async run(
    request: AutomationStartRequest,
    characterId: string,
    personaName: string,
    personaBackground: string | null,
    options: RunOptions
  ): Promise<void> {
    const active = this.active!;
    const conversationId = active.conversationId;
    let status: AutomationRunStatus = 'completed';
    let error: string | null = null;
    let repeatStrikes = 0;

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

        // The persona's line. A draft that is nearly a copy of something recent is redrafted, with
        // a note saying so; if it still is, it is sent anyway and counted as a strike below.
        let rawSuggestion: string | null = null;
        let scriptedLine: string | null = null;
        const retries = { persona: 0, character: 0 };
        let repeated = false;
        const guard = options.repeatGuard !== false;
        if (!waiting && options.scripted) {
          // Speed test: the same words for every model, in the same order. No model call for it.
          scriptedLine = SCRIPTED_LINES[(index - 1) % SCRIPTED_LINES.length];
        } else if (!waiting) {
          const recentLines = this.conversations
            .getMessages(conversationId)
            .slice(-REPEAT_WINDOW)
            .map((message) => message.content);
          const draft = async (avoidRepeats: boolean) => {
            this.emit('persona', false);
            return this.chat.suggestReply(
              conversationId,
              characterId,
              request.personaId,
              personaName,
              personaBackground,
              request.model,
              DEFAULT_HISTORY_LIMIT,
              { directions: request.personaDirections?.trim() || undefined, avoidRepeats }
            );
          };
          rawSuggestion = await draft(false);
          while (
            guard &&
            !active.stopRequested &&
            isRepeat(cleanSuggestion(rawSuggestion, personaName), recentLines) &&
            retries.persona < MAX_REPEAT_RETRIES
          ) {
            retries.persona += 1;
            rawSuggestion = await draft(true);
          }
          if (active.stopRequested) {
            status = 'stopped';
            break;
          }
          if (!cleanSuggestion(rawSuggestion, personaName)) {
            throw new Error(`The model returned an empty line for ${personaName} on turn ${index}.`);
          }
          repeated = guard && isRepeat(cleanSuggestion(rawSuggestion, personaName), recentLines);
        }

        this.emit('character', false);
        let result = await this.chat.generate(
          {
            conversationId,
            characterId,
            personaId: request.personaId,
            personaName,
            personaBackground,
            userMessage: waiting ? waiting.content : (scriptedLine ?? cleanSuggestion(rawSuggestion!, personaName)),
            replyToMessageId: waiting?.id,
            model: request.model,
            directions: request.directions?.trim() || undefined,
            samplers: request.samplers,
          },
          () => {}
        );

        // The character's reply, held to the same standard against her own earlier replies. A redo
        // is the app's normal way of getting another version of a reply (the repeat stays reachable
        // as a variant), run a little hotter and with a firmer repeat penalty.
        const earlierReplies = this.conversations
          .getMessages(conversationId)
          .filter((message) => message.role === 'assistant' && message.id !== result.message.id)
          .slice(-REPEAT_WINDOW)
          .map((message) => message.content);
        while (
          guard &&
          !active.stopRequested &&
          isRepeat(result.message.content, earlierReplies) &&
          retries.character < MAX_REPEAT_RETRIES
        ) {
          retries.character += 1;
          result = {
            ...(await this.chat.regenerate(
              conversationId,
              () => {},
              {
                ...request.samplers,
                temperature: Math.min((request.samplers?.temperature ?? 0.85) + 0.15 * retries.character, 1.3),
                repetitionPenalty: 1.2,
              },
              request.model
            )),
            userMessage: result.userMessage,
          };
        }
        repeated = repeated || (guard && isRepeat(result.message.content, earlierReplies));

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
          repeatRetries: retries,
          stillRepeating: repeated,
          debug: slimDebug(result.debug, index === 1),
        };
        this.runs.appendTurn(active.summary.id, turn);
        active.summary = { ...active.summary, completedTurns: index };
        this.emit('idle', true);

        // Redrafting did not break the loop. Three such turns in a row means more turns would only
        // be more of the same, so the run ends here with a log that says why.
        repeatStrikes = repeated ? repeatStrikes + 1 : 0;
        if (repeatStrikes >= MAX_REPEAT_STRIKES) {
          status = 'stopped';
          error = `Stopped automatically after turn ${index}: the conversation kept repeating itself even after retries.`;
          break;
        }
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
