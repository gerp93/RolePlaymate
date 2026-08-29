import { ConversationService } from '../database/conversationService';
import { PromptBuilder } from './promptBuilder';
import { LorebookService } from '../database/lorebookService';
import { ScenarioService } from '../database/scenarioService';
import { scanLore, splitByScope } from './loreMatcher';
import { OllamaClient, OllamaChatMessage, OllamaOptions } from './ollamaClient';
import {
  retrieveMemories,
  blobToVector,
  vectorToBlob,
  MemoryRetrievalOptions,
  MemoryWithEmbedding,
} from './memoryRetrieval';
import { extractMemories } from './memoryExtraction';
import { suggestPersonaReply } from './suggestReply';
import { Message } from '../../shared/types/message';
import { ChatDebugInfo, SamplerParams } from '../../shared/types/chat';
import { ConversationMemory } from '../../shared/types/conversationMemory';
import { ModelSamplerService } from '../database/modelSamplerService';
import { getConfiguredMemoryEmbeddingModel } from '../dbLocation';

/**
 * A generated reply that hasn't been folded into the model's context or mined for memories
 * yet -- the redo/swipe window. It becomes real (pushed into `history`, extracted) only when
 * the next turn starts, at which point whichever variant is currently selected is what
 * "happened". Nothing before that point is visible to the model or to extraction, which is
 * the whole point: redoing must not leak the response(s) you didn't keep.
 */
export interface PendingTurn {
  /** Null for a continuation turn -- see ChatSessionManager.continueAsCharacter, which appends
   * another assistant message with no new user message in between. */
  userMessage: string | null;
  assistantMessageId: string;
  model: string;
  systemPrompt: string;
  stopPhrases: string[];
  shouldExtract: boolean;
}

/** Default per-turn nudge for continueAsCharacter when the caller doesn't supply their own
 * directions -- kept macro-free (no {char}/{persona}) since `directions` is a leaf value
 * substituted verbatim into the CURRENT SCENE INSTRUCTIONS template, not itself re-filled. */
export const DEFAULT_CONTINUE_DIRECTIONS =
  "Continue the scene on your own -- no one has responded yet. Add another beat, action, or line without waiting.";

/**
 * Defaults ported from KVGenius's generate_chat_response. topP/topK/repetitionPenalty match
 * Ollama's own defaults, so sending them changes nothing today -- but the source stored them
 * per character and then never sent them, which made them look configurable when they were
 * inert. Sending them means wiring the setting later is a one-line change rather than a bug
 * report.
 */
export const DEFAULT_SAMPLERS: SamplerParams = {
  temperature: 0.7,
  maxTokens: 256,
  topP: 0.95,
  topK: 50,
  repetitionPenalty: 1.1,
};

/** Sliding window over prior turns, matching the source's hard-coded 20. Becomes a setting
 * when the settings layer lands. */
export const DEFAULT_HISTORY_LIMIT = 20;

/**
 * Per-conversation state.
 *
 * KVGenius held all of this in module globals (`_conversation_history`,
 * `_current_chat_model_*`, `_last_debug_info`), which is why it could only ever have one
 * live conversation. Keyed by conversation id here instead, so switching conversations --
 * or having two open -- is not a special case.
 */
export interface ChatSession {
  conversationId: string;
  /** Mirrors the persisted transcript, trimmed to the history window -- but never includes the
   * pending turn, if there is one. That's what keeps a redone response out of context until
   * it's finalized. */
  history: OllamaChatMessage[];
  pending: PendingTurn | null;
  abort: AbortController | null;
  lastDebug: ChatDebugInfo | null;
}

export interface GenerateRequest {
  conversationId: string;
  characterId: string;
  /** Only needed to scan the persona's own personal history -- name/background above already
   * carry everything the prompt itself needs. */
  personaId?: string | null;
  personaName?: string | null;
  personaBackground?: string | null;
  userMessage: string;
  model: string;
  directions?: string;
  memories?: string[];
  samplers?: Partial<SamplerParams>;
  historyLimit?: number;
  memoryOptions?: MemoryRetrievalOptions;
  /** Regenerating must not extract: the exchange has already been mined once, and running it
   * again on a second phrasing of the same reply just inserts near-duplicates. */
  extractMemories?: boolean;
}

export interface GenerateResult {
  message: Message;
  debug: ChatDebugInfo;
  /** The real, persisted user turn this reply answers -- set by `generate` (a fresh insert)
   * and `editPriorUserMessage` (an in-place rewrite) so the renderer can reconcile its
   * optimistic copy with what's actually in the database. Absent for `continueAsCharacter`
   * (no user message involved) and `regenerate` (doesn't touch one). */
  userMessage?: Message;
}

/** Same shape as GenerateRequest minus `userMessage` -- see ChatSessionManager.continueAsCharacter. */
export type ContinueRequest = Omit<GenerateRequest, 'userMessage' | 'extractMemories'>;

/** Clamps ported verbatim from the source -- a temperature of 0 or a repeat_penalty below 1
 * makes Ollama behave in ways users read as broken. */
export function toOllamaOptions(samplers: SamplerParams, stop: string[]): OllamaOptions {
  return {
    temperature: Math.max(samplers.temperature, 0.1),
    top_p: Math.min(Math.max(samplers.topP, 0.1), 1),
    top_k: samplers.topK > 0 ? samplers.topK : 50,
    repeat_penalty: Math.max(samplers.repetitionPenalty, 1),
    num_predict: samplers.maxTokens,
    ...(stop.length > 0 ? { stop } : {}),
  };
}

/** Renders the outgoing request the way the debug console shows it. */
export function renderMessagesForDebug(messages: OllamaChatMessage[]): string {
  return messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');
}

export class ChatSessionManager {
  private sessions = new Map<string, ChatSession>();

  /**
   * Called when post-turn extraction stored new memories.
   *
   * Extraction finishes after the reply has already been returned, so there is no response
   * left to attach the result to -- the main process turns this into a `chat:memories-updated`
   * event and the renderer refreshes its count. Left unset, extraction still runs and still
   * stores; only the live UI refresh is lost.
   */
  onMemoriesExtracted: ((conversationId: string, added: ConversationMemory[]) => void) | null =
    null;

  constructor(
    private conversations: ConversationService,
    private prompts: PromptBuilder,
    private ollama: OllamaClient,
    private lorebooks: LorebookService,
    private modelSamplers: ModelSamplerService,
    private scenarios: ScenarioService
  ) {}

  /** Resolves a conversation's selected scenario (if any) into the text `buildSystemPrompt`
   * needs -- the one place this lookup happens, so every generation path (generate,
   * editPriorUserMessage, continueAsCharacter, reconstructPending, suggestReply) stays
   * internally consistent without threading scenarioId through each request type. */
  private getScenarioContent(conversationId: string): string | null {
    const conversation = this.conversations.getConversation(conversationId);
    if (!conversation?.scenarioId) return null;
    return this.scenarios.getActiveContent(conversation.scenarioId);
  }

  /**
   * Loads history from the database on first use, so reopening a conversation resumes it.
   *
   * If the conversation's last message is an unanswered-since assistant turn (nothing sent
   * after it), that turn is still "pending" -- redoable, and not yet folded into `history` --
   * exactly as it was left. This is how redo survives a conversation switch or an app
   * restart: nothing about pending-ness is stored explicitly, it's just "the last message is
   * an assistant reply with no newer user message".
   */
  getSession(conversationId: string): ChatSession {
    let session = this.sessions.get(conversationId);
    if (!session) {
      const transcript = this.conversations.getMessages(conversationId).filter((m) => m.role !== 'system');
      const last = transcript.at(-1);
      const precedingUser = transcript.at(-2);

      const pending =
        last?.role === 'assistant' && precedingUser?.role === 'user'
          ? this.reconstructPending(conversationId, precedingUser.content, last.id)
          : null;
      const historyMessages = pending ? transcript.slice(0, -2) : transcript;

      session = {
        conversationId,
        history: historyMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        pending,
        abort: null,
        lastDebug: null,
      };
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  /**
   * Rebuilds enough of a pending turn's context to redo it or extract memories from it, for a
   * turn that outlived the process that generated it (app restart, or the very first
   * `getSession` after the app starts).
   *
   * This is necessarily approximate: per-turn directions, retrieved memories and lore firing
   * aren't recoverable, only the character/persona backdrop is. A redo issued after a restart
   * therefore uses a slightly plainer prompt than the turn it's replacing would have. Within
   * one continuous run this path is never hit -- `pending` is set directly by `generate`,
   * carrying the exact prompt that turn used.
   */
  private reconstructPending(
    conversationId: string,
    userMessage: string,
    assistantMessageId: string
  ): PendingTurn | null {
    const conversation = this.conversations.getConversation(conversationId);
    if (!conversation?.characterId) return null;

    try {
      const persona = conversation.userPersonaId
        ? this.conversations.getPersona(conversation.userPersonaId)
        : null;
      const scenarioContent = conversation.scenarioId
        ? this.scenarios.getActiveContent(conversation.scenarioId)
        : null;
      const built = this.prompts.buildSystemPrompt(conversation.characterId, {
        personaName: persona?.name,
        personaBackground: persona?.background,
        scenarioContent,
      });
      return {
        userMessage,
        assistantMessageId,
        model: conversation.model,
        systemPrompt: built.prompt,
        stopPhrases: built.stopPhrases,
        shouldExtract: true,
      };
    } catch {
      // Character deleted out from under the conversation -- nothing to rebuild a prompt from.
      return null;
    }
  }

  dropSession(conversationId: string): void {
    this.sessions.get(conversationId)?.abort?.abort();
    this.sessions.delete(conversationId);
  }

  /**
   * Deletes the conversation's last message (LIFO -- see conversationService.deleteMessage)
   * and any memories it produced, then drops the in-memory session so the next access rebuilds
   * `history`/`pending` from what's actually left in the database rather than an in-memory
   * copy that still thinks the deleted turn happened.
   */
  deleteMessage(conversationId: string, messageId: string): void {
    if (this.isGenerating(conversationId)) {
      throw new Error('Cannot delete a message while a response is generating');
    }
    this.conversations.deleteMessage(conversationId, messageId);
    this.dropSession(conversationId);
  }

  isGenerating(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.abort != null;
  }

  cancel(conversationId: string): boolean {
    const session = this.sessions.get(conversationId);
    if (!session?.abort) return false;
    session.abort.abort();
    return true;
  }

  /**
   * Runs one turn: persists the user message, streams the reply, persists it, and returns
   * the debug payload.
   *
   * The user message is persisted *before* generation so a crash or a cancel can't lose what
   * the user typed. The assistant message is persisted only on success -- an error is never
   * written as an assistant turn, which the source did, poisoning the context of every
   * later turn with its own error text.
   *
   * The *previous* turn's reply -- still pending if the user redid it, looked at the
   * alternatives, and then just typed the next message without explicitly picking one -- is
   * finalized first: whichever variant is currently selected is what "happened", folded into
   * context and handed to extraction now that the user has moved on from it.
   */
  async generate(
    request: GenerateRequest,
    onToken: (text: string) => void
  ): Promise<GenerateResult> {
    const session = this.getSession(request.conversationId);
    if (session.abort) {
      throw new Error('A response is already being generated for this conversation');
    }

    // Layered: global default, then this model's tuned defaults (Model Tuning settings page),
    // then a chat-level override (the Composer sliders) -- whichever of those actually sets a
    // given field wins, later layers taking precedence over earlier ones.
    const samplers = {
      ...this.modelSamplers.getEffective(request.model, DEFAULT_SAMPLERS),
      ...request.samplers,
    };
    const historyLimit = request.historyLimit ?? DEFAULT_HISTORY_LIMIT;

    this.finalizePending(session, historyLimit);

    const historyTurns = session.history.slice(-historyLimit);

    // Retrieval runs against the message being sent, not the whole transcript: what matters
    // is which stored facts bear on what the user just said.
    const retrieval = await this.retrieve(
      request.conversationId,
      request.userMessage,
      request.memories,
      request.memoryOptions
    );
    const memoryTexts = retrieval
      ? retrieval.result.selected.map((entry) => entry.memory.content)
      : (request.memories ?? []);

    // Lore is scanned against the recent transcript plus the message being sent, so an entry
    // fires on what the scene is about now rather than on anything ever mentioned.
    const characterLore = scanLore(
      this.lorebooks.getEntriesForCharacter(request.characterId),
      historyTurns,
      request.userMessage
    );
    // Scanned separately, with its own budget, rather than merged into the character's
    // entries before scanning -- a persona's history shouldn't lose its budget race to a
    // character with a bigger book, and keeping the two scans independent is what makes that
    // true regardless of either book's size.
    const personaLoreResult = request.personaId
      ? scanLore(this.lorebooks.getEntriesForPersona(request.personaId), historyTurns, request.userMessage)
      : null;

    const { world: worldLore, personal: personalLore } = splitByScope(characterLore.selected);
    const personaLore = personaLoreResult?.selected ?? [];

    // Merged for the debug console, which shows one lore panel -- each entry still carries its
    // own lorebookName ("Veridia's history" vs. "Clyde's history"), so whose memory it is stays
    // visible even without a dedicated second panel.
    const lore = personaLoreResult
      ? {
          selected: [...characterLore.selected, ...personaLoreResult.selected],
          rejected: [...characterLore.rejected, ...personaLoreResult.rejected],
          consideredCount: characterLore.consideredCount + personaLoreResult.consideredCount,
          budgetTokensUsed: characterLore.budgetTokensUsed + personaLoreResult.budgetTokensUsed,
          budgetTokensMax: characterLore.budgetTokensMax + personaLoreResult.budgetTokensMax,
          scanText: characterLore.scanText,
        }
      : characterLore;

    const built = this.prompts.buildSystemPrompt(request.characterId, {
      personaName: request.personaName,
      personaBackground: request.personaBackground,
      scenarioContent: this.getScenarioContent(request.conversationId),
      directions: request.directions,
      memories: memoryTexts,
      worldLore,
      personalLore,
      personaLore,
    });
    const messages: OllamaChatMessage[] = [
      ...(built.prompt ? [{ role: 'system' as const, content: built.prompt }] : []),
      ...historyTurns,
      { role: 'user' as const, content: request.userMessage },
    ];
    const options = toOllamaOptions(samplers, built.stopPhrases);

    const userMessage = this.conversations.appendMessage({
      conversationId: request.conversationId,
      role: 'user',
      content: request.userMessage,
    });

    const controller = new AbortController();
    session.abort = controller;

    try {
      const result = await this.ollama.chat({
        model: request.model,
        messages,
        options,
        signal: controller.signal,
        onToken,
      });

      // Post-processing is trim() only, as in the source. Anything more (stripping name
      // prefixes, collapsing whitespace) silently mangles legitimate output.
      const content = result.content.trim();

      const debug: ChatDebugInfo = {
        baseSystemPrompt: built.baseSystemPrompt,
        characterInstructions: built.characterInstructions,
        personaName: request.personaName ?? '',
        personaBackground: request.personaBackground ?? '',
        directions: request.directions ?? '',
        memories: memoryTexts,
        retrieval: retrieval?.result ?? null,
        lore,
        systemPrompt: built.prompt,
        userMessage: request.userMessage,
        historyTurns,
        historyLength: historyTurns.length,
        fullPrompt: renderMessagesForDebug(messages),
        stopPhrases: built.stopPhrases,
        rawResponse: result.content,
        cleanedResponse: content,
        inputTokens: result.promptEvalCount,
        outputTokens: result.evalCount,
      };
      session.lastDebug = debug;

      const { message } = this.conversations.appendAssistantMessage(
        request.conversationId,
        content,
        request.model,
        debug
      );
      // The model can change freely turn to turn -- keep the conversation record (and the
      // sidebar) pointed at whichever one was actually used most recently.
      this.conversations.updateConversationModel(request.conversationId, request.model);

      // Not folded into `session.history` and not extracted -- that happens on the next
      // `generate` or `regenerate` call, once the user has settled on a variant by moving on
      // from this turn. See the class-level note on `pending`.
      session.pending = {
        userMessage: request.userMessage,
        assistantMessageId: message.id,
        model: request.model,
        systemPrompt: built.prompt,
        stopPhrases: built.stopPhrases,
        shouldExtract: request.extractMemories !== false,
      };

      return { message, debug, userMessage };
    } finally {
      // Always cleared, on success, error, and cancellation alike. The source left its
      // equivalent flag set when generation threw, which stuck the UI in "generating"
      // permanently with no way out but a restart.
      session.abort = null;
    }
  }

  /**
   * Regenerates the pending turn's reply: a new variant, using the exact same context and
   * system prompt the original response (or the last redo) used, so this is a resample of the
   * same question rather than a chance to also change the character, persona or directions
   * mid-turn. The model is the one exception -- an explicit `model` here lets a redo use
   * whatever's currently selected in the composer rather than being stuck on whatever the
   * first response used, matching that the model can change at any point in the conversation.
   *
   * Like the original response, the new variant is not folded into `history` or extracted --
   * it only replaces which variant is *selected*. Nothing about the pending turn's place in
   * the queue changes: the next `generate` call still finalizes whichever variant is selected
   * when it runs, exactly as if this were the first response.
   */
  async regenerate(
    conversationId: string,
    onToken: (text: string) => void,
    samplers?: Partial<SamplerParams>,
    model?: string
  ): Promise<GenerateResult> {
    const session = this.getSession(conversationId);
    if (session.abort) {
      throw new Error('A response is already being generated for this conversation');
    }
    const pending = session.pending;
    if (!pending) {
      throw new Error('Nothing to redo -- send a message first');
    }
    const effectiveModel = model || pending.model;

    const options = toOllamaOptions(
      { ...this.modelSamplers.getEffective(effectiveModel, DEFAULT_SAMPLERS), ...samplers },
      pending.stopPhrases
    );
    // A continuation turn (see continueAsCharacter) has no user message to replay here either --
    // same "no trailing user turn" shape its own generation used.
    const messages: OllamaChatMessage[] = [
      ...(pending.systemPrompt ? [{ role: 'system' as const, content: pending.systemPrompt }] : []),
      ...session.history,
      ...(pending.userMessage !== null ? [{ role: 'user' as const, content: pending.userMessage }] : []),
    ];

    const controller = new AbortController();
    session.abort = controller;

    try {
      const result = await this.ollama.chat({
        model: effectiveModel,
        messages,
        options,
        signal: controller.signal,
        onToken,
      });
      const content = result.content.trim();

      // A message from before redo support has no variant of its own yet -- back one out of
      // its current content first, or selecting the new variant below would lose it for good.
      // Its model is unknown (it predates this column too), left null rather than guessed.
      if (this.conversations.getVariants(pending.assistantMessageId).length === 0) {
        const current = this.conversations.getMessage(pending.assistantMessageId);
        if (current) this.conversations.addVariant(pending.assistantMessageId, current.content);
      }

      // The rest of the debug console (retrieval, lore, persona, directions) describes the
      // turn as a whole and didn't change; only what was actually sent and what came back did.
      // `lastDebug` can be null here -- a redo issued right after an app restart, before any
      // `generate` call in this process populated it -- so this falls back to what's actually
      // recoverable (session.history, the reconstructed prompt) rather than lying about the
      // unrecoverable parts (retrieval, lore, per-turn directions).
      const baseDebug: ChatDebugInfo =
        session.lastDebug ?? {
          baseSystemPrompt: '',
          characterInstructions: '',
          personaName: '',
          personaBackground: '',
          directions: '',
          memories: [],
          retrieval: null,
          lore: null,
          systemPrompt: pending.systemPrompt,
          userMessage: pending.userMessage ?? '',
          historyTurns: session.history,
          historyLength: session.history.length,
          fullPrompt: '',
          stopPhrases: pending.stopPhrases,
          rawResponse: '',
          cleanedResponse: '',
          inputTokens: null,
          outputTokens: null,
        };
      const debug: ChatDebugInfo = {
        ...baseDebug,
        fullPrompt: renderMessagesForDebug(messages),
        rawResponse: result.content,
        cleanedResponse: content,
        inputTokens: result.promptEvalCount,
        outputTokens: result.evalCount,
      };
      session.lastDebug = debug;

      const variant = this.conversations.addVariant(pending.assistantMessageId, content, effectiveModel, debug);
      const message = this.conversations.selectVariant(pending.assistantMessageId, variant.id);

      this.conversations.updateConversationModel(conversationId, effectiveModel);
      // A later redo with no explicit model falls back to whichever one this redo just used,
      // not all the way back to the original response's model.
      pending.model = effectiveModel;

      return { message, debug };
    } finally {
      session.abort = null;
    }
  }

  /**
   * Rewrites the user message that led to the *pending* assistant reply, then regenerates
   * that reply from scratch against the edited text -- for fixing a typo, or more usefully,
   * changing what was said and letting the character react to the new version instead.
   *
   * Deliberately restricted to the pending turn's own user message, the same boundary
   * `editMessage`/`chooseVariant` already enforce: anything earlier already has a reply after
   * it, and silently rewriting it would need to redo everything downstream to stay consistent.
   * Unlike `regenerate` (a resample of the same question), this rebuilds retrieval, lore, and
   * the system prompt fresh against the new text -- what's relevant to the new version of the
   * message may not be what was relevant to the old one. The reply still lands as a new variant
   * on the same assistant message, so the previous answer stays reachable through the variant
   * switcher.
   */
  async editPriorUserMessage(
    request: GenerateRequest & { messageId: string },
    onToken: (text: string) => void
  ): Promise<GenerateResult> {
    const session = this.getSession(request.conversationId);
    if (session.abort) {
      throw new Error('A response is already being generated for this conversation');
    }
    const pending = session.pending;
    if (!pending || pending.userMessage === null) {
      throw new Error('Only the message that led to the current pending reply can be edited this way');
    }

    const transcript = this.conversations.getMessages(request.conversationId);
    const priorUserMessage = transcript.at(-2);
    if (
      !priorUserMessage ||
      priorUserMessage.id !== request.messageId ||
      priorUserMessage.role !== 'user' ||
      transcript.at(-1)?.id !== pending.assistantMessageId
    ) {
      throw new Error('Only the message that led to the current pending reply can be edited this way');
    }

    const trimmed = request.userMessage.trim();
    if (!trimmed) {
      throw new Error('Message cannot be empty');
    }

    const samplers = {
      ...this.modelSamplers.getEffective(request.model, DEFAULT_SAMPLERS),
      ...request.samplers,
    };
    const historyLimit = request.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    // Not finalizePending -- this turn isn't being moved past, it's being redone in place.
    const historyTurns = session.history.slice(-historyLimit);

    const retrieval = await this.retrieve(
      request.conversationId,
      trimmed,
      request.memories,
      request.memoryOptions
    );
    const memoryTexts = retrieval
      ? retrieval.result.selected.map((entry) => entry.memory.content)
      : (request.memories ?? []);

    const characterLore = scanLore(this.lorebooks.getEntriesForCharacter(request.characterId), historyTurns, trimmed);
    const personaLoreResult = request.personaId
      ? scanLore(this.lorebooks.getEntriesForPersona(request.personaId), historyTurns, trimmed)
      : null;

    const { world: worldLore, personal: personalLore } = splitByScope(characterLore.selected);
    const personaLore = personaLoreResult?.selected ?? [];

    const lore = personaLoreResult
      ? {
          selected: [...characterLore.selected, ...personaLoreResult.selected],
          rejected: [...characterLore.rejected, ...personaLoreResult.rejected],
          consideredCount: characterLore.consideredCount + personaLoreResult.consideredCount,
          budgetTokensUsed: characterLore.budgetTokensUsed + personaLoreResult.budgetTokensUsed,
          budgetTokensMax: characterLore.budgetTokensMax + personaLoreResult.budgetTokensMax,
          scanText: characterLore.scanText,
        }
      : characterLore;

    const built = this.prompts.buildSystemPrompt(request.characterId, {
      personaName: request.personaName,
      personaBackground: request.personaBackground,
      scenarioContent: this.getScenarioContent(request.conversationId),
      directions: request.directions,
      memories: memoryTexts,
      worldLore,
      personalLore,
      personaLore,
    });
    const messages: OllamaChatMessage[] = [
      ...(built.prompt ? [{ role: 'system' as const, content: built.prompt }] : []),
      ...historyTurns,
      { role: 'user' as const, content: trimmed },
    ];
    const options = toOllamaOptions(samplers, built.stopPhrases);

    const userMessage = this.conversations.updateMessageContent(priorUserMessage.id, trimmed);

    const controller = new AbortController();
    session.abort = controller;

    try {
      const result = await this.ollama.chat({
        model: request.model,
        messages,
        options,
        signal: controller.signal,
        onToken,
      });
      const content = result.content.trim();

      const debug: ChatDebugInfo = {
        baseSystemPrompt: built.baseSystemPrompt,
        characterInstructions: built.characterInstructions,
        personaName: request.personaName ?? '',
        personaBackground: request.personaBackground ?? '',
        directions: request.directions ?? '',
        memories: memoryTexts,
        retrieval: retrieval?.result ?? null,
        lore,
        systemPrompt: built.prompt,
        userMessage: trimmed,
        historyTurns,
        historyLength: historyTurns.length,
        fullPrompt: renderMessagesForDebug(messages),
        stopPhrases: built.stopPhrases,
        rawResponse: result.content,
        cleanedResponse: content,
        inputTokens: result.promptEvalCount,
        outputTokens: result.evalCount,
      };
      session.lastDebug = debug;

      // Same backfill as regenerate/editMessage: a message from before redo support has no
      // variant of its own yet, so the reply this is about to replace would otherwise be lost.
      if (this.conversations.getVariants(pending.assistantMessageId).length === 0) {
        const current = this.conversations.getMessage(pending.assistantMessageId);
        if (current) this.conversations.addVariant(pending.assistantMessageId, current.content);
      }

      const variant = this.conversations.addVariant(pending.assistantMessageId, content, request.model, debug);
      const message = this.conversations.selectVariant(pending.assistantMessageId, variant.id);

      this.conversations.updateConversationModel(request.conversationId, request.model);

      session.pending = {
        userMessage: trimmed,
        assistantMessageId: pending.assistantMessageId,
        model: request.model,
        systemPrompt: built.prompt,
        stopPhrases: built.stopPhrases,
        shouldExtract: request.extractMemories !== false,
      };

      return { message, debug, userMessage };
    } finally {
      session.abort = null;
    }
  }

  /**
   * Appends another assistant message with no new user message in between -- lets the
   * character take a second (or third...) turn on its own, for when the user wants the scene
   * to keep moving without having to type something first. Structurally this is `generate()`
   * with the trailing user turn removed: same finalize-pending-first, retrieval, and lore-scan
   * steps, just scanned against the most recent line already in the transcript instead of a
   * new message, since there isn't one this turn.
   *
   * The new message becomes pending exactly like a normal reply -- redoable and editable until
   * the next real turn or continuation folds it into history.
   */
  async continueAsCharacter(request: ContinueRequest, onToken: (text: string) => void): Promise<GenerateResult> {
    const session = this.getSession(request.conversationId);
    if (session.abort) {
      throw new Error('A response is already being generated for this conversation');
    }

    // Layered: global default, then this model's tuned defaults (Model Tuning settings page),
    // then a chat-level override (the Composer sliders) -- whichever of those actually sets a
    // given field wins, later layers taking precedence over earlier ones.
    const samplers = {
      ...this.modelSamplers.getEffective(request.model, DEFAULT_SAMPLERS),
      ...request.samplers,
    };
    const historyLimit = request.historyLimit ?? DEFAULT_HISTORY_LIMIT;

    this.finalizePending(session, historyLimit);

    const historyTurns = session.history.slice(-historyLimit);
    if (historyTurns.length === 0) {
      throw new Error('Nothing to continue -- send a message first.');
    }
    // No new user message to scan against -- the most recent line already in the scene is the
    // closest thing to "what's relevant right now".
    const scanQuery = historyTurns.at(-1)!.content;

    const retrieval = await this.retrieve(
      request.conversationId,
      scanQuery,
      request.memories,
      request.memoryOptions
    );
    const memoryTexts = retrieval
      ? retrieval.result.selected.map((entry) => entry.memory.content)
      : (request.memories ?? []);

    const characterLore = scanLore(this.lorebooks.getEntriesForCharacter(request.characterId), historyTurns, scanQuery);
    const personaLoreResult = request.personaId
      ? scanLore(this.lorebooks.getEntriesForPersona(request.personaId), historyTurns, scanQuery)
      : null;

    const { world: worldLore, personal: personalLore } = splitByScope(characterLore.selected);
    const personaLore = personaLoreResult?.selected ?? [];

    const lore = personaLoreResult
      ? {
          selected: [...characterLore.selected, ...personaLoreResult.selected],
          rejected: [...characterLore.rejected, ...personaLoreResult.rejected],
          consideredCount: characterLore.consideredCount + personaLoreResult.consideredCount,
          budgetTokensUsed: characterLore.budgetTokensUsed + personaLoreResult.budgetTokensUsed,
          budgetTokensMax: characterLore.budgetTokensMax + personaLoreResult.budgetTokensMax,
          scanText: characterLore.scanText,
        }
      : characterLore;

    // Falls back to a built-in nudge rather than leaving the section empty -- a blank
    // directions section reads to a smaller model as "nothing special," and it'll often just
    // wait rather than understanding it should keep going unprompted.
    const directions = request.directions?.trim() || DEFAULT_CONTINUE_DIRECTIONS;

    const built = this.prompts.buildSystemPrompt(request.characterId, {
      personaName: request.personaName,
      personaBackground: request.personaBackground,
      scenarioContent: this.getScenarioContent(request.conversationId),
      directions,
      memories: memoryTexts,
      worldLore,
      personalLore,
      personaLore,
    });
    // No trailing `{ role: 'user', ... }` -- that's the whole point. Whatever chat template the
    // model uses gets to decide how it handles two turns from the same role in a row; most
    // roleplay-tuned models handle this fine, same as SillyTavern's "Continue" does.
    const messages: OllamaChatMessage[] = [
      ...(built.prompt ? [{ role: 'system' as const, content: built.prompt }] : []),
      ...historyTurns,
    ];
    const options = toOllamaOptions(samplers, built.stopPhrases);

    const controller = new AbortController();
    session.abort = controller;

    try {
      const result = await this.ollama.chat({
        model: request.model,
        messages,
        options,
        signal: controller.signal,
        onToken,
      });
      const content = result.content.trim();

      const debug: ChatDebugInfo = {
        baseSystemPrompt: built.baseSystemPrompt,
        characterInstructions: built.characterInstructions,
        personaName: request.personaName ?? '',
        personaBackground: request.personaBackground ?? '',
        directions,
        memories: memoryTexts,
        retrieval: retrieval?.result ?? null,
        lore,
        systemPrompt: built.prompt,
        userMessage: '',
        historyTurns,
        historyLength: historyTurns.length,
        fullPrompt: renderMessagesForDebug(messages),
        stopPhrases: built.stopPhrases,
        rawResponse: result.content,
        cleanedResponse: content,
        inputTokens: result.promptEvalCount,
        outputTokens: result.evalCount,
      };
      session.lastDebug = debug;

      const { message } = this.conversations.appendAssistantMessage(
        request.conversationId,
        content,
        request.model,
        debug
      );
      this.conversations.updateConversationModel(request.conversationId, request.model);

      session.pending = {
        userMessage: null,
        assistantMessageId: message.id,
        model: request.model,
        systemPrompt: built.prompt,
        stopPhrases: built.stopPhrases,
        shouldExtract: true,
      };

      return { message, debug };
    } finally {
      session.abort = null;
    }
  }

  /**
   * Hand-edits the pending assistant message: records the new text as its own variant (the
   * same "nothing is overwritten" pattern redo already uses) and selects it, rather than
   * mutating the existing variant's content in place. The original generation stays reachable
   * through the variant switcher exactly like a redo you swipe away from.
   *
   * Restricted to the pending message for the same reason chooseVariant is: an older assistant
   * turn already has a user reply after it, so silently rewriting it would also need to redo
   * everything downstream to stay consistent, which this isn't trying to solve.
   */
  editMessage(conversationId: string, messageId: string, content: string): Message {
    if (this.isGenerating(conversationId)) {
      throw new Error('Cannot edit a message while a response is generating');
    }
    const session = this.getSession(conversationId);
    if (!session.pending || session.pending.assistantMessageId !== messageId) {
      throw new Error('Only the most recent response can be edited');
    }
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('Message cannot be empty');
    }

    // A message from before redo support has no variant of its own yet -- back one out of its
    // current content first, same as regenerate does, or adding the edit below would lose the
    // original generation for good.
    if (this.conversations.getVariants(messageId).length === 0) {
      const current = this.conversations.getMessage(messageId);
      if (current) this.conversations.addVariant(messageId, current.content);
    }

    // No model attached -- this content didn't come from a generation, and null already means
    // "not attributable to a model" elsewhere (the same pre-redo-support backfill above).
    // pending.model is deliberately left alone: a later redo with no explicit model should
    // still resample the last *generated* variant's model, not "null".
    const variant = this.conversations.addVariant(messageId, trimmed);
    return this.conversations.selectVariant(messageId, variant.id);
  }

  /** Switches which variant of the pending message is shown -- cheap and immediate, no model
   * call. Only the pending (most recent, unanswered-since) assistant message is redoable, so
   * this rejects anything else rather than quietly rewriting older history. */
  chooseVariant(conversationId: string, messageId: string, variantId: string): Message {
    const session = this.getSession(conversationId);
    if (!session.pending || session.pending.assistantMessageId !== messageId) {
      throw new Error('Only the most recent response can be redone or switched between variants');
    }
    const message = this.conversations.selectVariant(messageId, variantId);
    // A subsequent redo (no explicit model) picks up from whichever variant is now showing,
    // same as it does after a redo itself picks a model.
    if (message.model) session.pending.model = message.model;
    return message;
  }

  /**
   * Drafts what the user's persona might say next -- purely a suggestion for the composer,
   * never persisted and never touching `history` or `pending`. Reads the transcript straight
   * from the database rather than `session.history` so it reflects exactly what's on screen,
   * including a still-pending, not-yet-finalized redo of the character's last line.
   */
  async suggestReply(
    conversationId: string,
    characterId: string,
    personaId: string | null,
    personaName: string | null,
    personaBackground: string | null,
    model: string,
    historyLimit: number = DEFAULT_HISTORY_LIMIT
  ): Promise<string> {
    const transcript = this.conversations
      .getMessages(conversationId)
      .filter((m) => m.role !== 'system')
      .slice(-historyLimit);
    const recentTurns = transcript.map((m) => ({ role: m.role, content: m.content }));

    // Unlike generate(), also pulls in world books attached to the persona itself -- this is
    // the one place that's meant to surface. See getEntriesForPersonaWithWorldBooks.
    const personaEntries = personaId
      ? scanLore(this.lorebooks.getEntriesForPersonaWithWorldBooks(personaId), recentTurns, '').selected
      : [];
    const { world: personaWorldLore, personal: personaLore } = splitByScope(personaEntries);

    const built = this.prompts.buildSystemPrompt(characterId, {
      personaName,
      personaBackground,
      scenarioContent: this.getScenarioContent(conversationId),
      personaLore,
      worldLore: personaWorldLore,
    });

    return suggestPersonaReply(this.ollama, model, {
      characterContext: built.prompt,
      historyTurns: recentTurns,
      characterName: built.characterName,
      personaName: personaName?.trim() || 'You',
    });
  }

  /**
   * Folds the pending turn (if any) into `history` and hands it to extraction, because the
   * user has moved on to a new message -- whichever variant was selected is what "happened".
   * Idempotent: a session with nothing pending is a no-op, so callers don't need to check
   * first.
   */
  private finalizePending(session: ChatSession, historyLimit: number): void {
    const pending = session.pending;
    if (!pending) return;
    session.pending = null;

    const message = this.conversations.getMessage(pending.assistantMessageId);
    const finalContent = message?.content ?? '';

    // A continuation turn (see continueAsCharacter) has no new user message to push -- the
    // character just added another line of its own onto the existing history.
    if (pending.userMessage !== null) {
      session.history.push({ role: 'user', content: pending.userMessage });
    }
    session.history.push({ role: 'assistant', content: finalContent });
    if (session.history.length > historyLimit) {
      session.history = session.history.slice(-historyLimit);
    }

    if (pending.shouldExtract && finalContent) {
      // Deliberately not awaited, same as the source's inline call would have blocked --
      // extraction is a second model call, and the turn that triggered finalizing is already
      // underway generating its own reply.
      void this.extract(
        {
          conversationId: session.conversationId,
          model: pending.model,
          userMessage: pending.userMessage ?? '',
          messageId: pending.assistantMessageId,
        },
        pending.systemPrompt,
        finalContent
      );
    }
  }

  /**
   * Scores this conversation's stored memories against the outgoing message.
   *
   * Returns null when the caller passed an explicit `memories` list (the prompt-preview path
   * supplies its own) or the conversation has none stored, so the debug console can tell
   * "retrieval didn't run" apart from "retrieval ran and selected nothing".
   */
  private async retrieve(
    conversationId: string,
    query: string,
    explicitMemories: string[] | undefined,
    options?: MemoryRetrievalOptions
  ) {
    if (explicitMemories) return null;

    const rows = this.conversations.listMemoriesWithEmbeddings(conversationId);
    if (rows.length === 0) return null;

    const candidates: MemoryWithEmbedding[] = rows.map((row) => ({
      memory: row.memory,
      embedding: row.embedding ? blobToVector(row.embedding) : null,
      embeddingModel: row.embeddingModel,
    }));

    const outcome = await retrieveMemories(this.ollama, query, candidates, {
      ...options,
      embeddingModel: options?.embeddingModel ?? getConfiguredMemoryEmbeddingModel(),
    });

    // Write freshly computed vectors back so the next turn only embeds the query.
    if (outcome.computed.length > 0) {
      this.conversations.setMemoryEmbeddings(
        outcome.computed.map((entry) => ({
          memoryId: entry.memoryId,
          embedding: vectorToBlob(entry.vector),
          embeddingModel: entry.model,
        }))
      );
    }

    return outcome;
  }

  /**
   * Mines the completed exchange for durable facts, after the reply has been delivered.
   *
   * Never throws into the turn: a failed extraction should cost the conversation nothing,
   * and by this point the user already has their reply.
   */
  private async extract(
    turn: { conversationId: string; model: string; userMessage: string; messageId: string },
    systemPrompt: string,
    aiResponse: string
  ): Promise<ConversationMemory[]> {
    try {
      const existing = this.conversations.listMemories(turn.conversationId);
      const facts = await extractMemories(this.ollama, turn.model, {
        userMessage: turn.userMessage,
        aiResponse,
        existingMemories: existing.map((memory) => memory.content),
        systemPrompt,
      });

      const added = facts.map((content) =>
        this.conversations.addMemory({
          conversationId: turn.conversationId,
          content,
          source: 'auto',
          messageId: turn.messageId,
        })
      );

      if (added.length > 0) this.onMemoriesExtracted?.(turn.conversationId, added);
      return added;
    } catch {
      return [];
    }
  }
}
