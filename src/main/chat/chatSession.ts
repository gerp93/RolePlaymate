import {
  ConversationService,
  deriveTitle,
  DEFAULT_CONVERSATION_TITLE,
} from '../database/conversationService';
import { PromptBuilder } from './promptBuilder';
import { LorebookService } from '../database/lorebookService';
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
import { Message } from '../../shared/types/message';
import { ChatDebugInfo, SamplerParams } from '../../shared/types/chat';
import { ConversationMemory } from '../../shared/types/conversationMemory';

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
  /** Mirrors the persisted transcript, trimmed to the history window. */
  history: OllamaChatMessage[];
  abort: AbortController | null;
  lastDebug: ChatDebugInfo | null;
}

export interface GenerateRequest {
  conversationId: string;
  characterId: string;
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
}

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
    private lorebooks: LorebookService
  ) {}

  /** Loads history from the database on first use, so reopening a conversation resumes it. */
  getSession(conversationId: string): ChatSession {
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = {
        conversationId,
        history: this.conversations
          .getMessages(conversationId)
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        abort: null,
        lastDebug: null,
      };
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  dropSession(conversationId: string): void {
    this.sessions.get(conversationId)?.abort?.abort();
    this.sessions.delete(conversationId);
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
   */
  async generate(
    request: GenerateRequest,
    onToken: (text: string) => void
  ): Promise<GenerateResult> {
    const session = this.getSession(request.conversationId);
    if (session.abort) {
      throw new Error('A response is already being generated for this conversation');
    }

    const samplers = { ...DEFAULT_SAMPLERS, ...request.samplers };
    const historyLimit = request.historyLimit ?? DEFAULT_HISTORY_LIMIT;

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
    const lore = scanLore(
      this.lorebooks.getEntriesForCharacter(request.characterId),
      historyTurns,
      request.userMessage
    );
    const { world: worldLore, personal: personalLore } = splitByScope(lore.selected);

    const built = this.prompts.buildSystemPrompt(request.characterId, {
      personaName: request.personaName,
      personaBackground: request.personaBackground,
      directions: request.directions,
      memories: memoryTexts,
      worldLore,
      personalLore,
    });
    const messages: OllamaChatMessage[] = [
      ...(built.prompt ? [{ role: 'system' as const, content: built.prompt }] : []),
      ...historyTurns,
      { role: 'user' as const, content: request.userMessage },
    ];
    const options = toOllamaOptions(samplers, built.stopPhrases);

    this.conversations.appendMessage({
      conversationId: request.conversationId,
      role: 'user',
      content: request.userMessage,
    });

    // Name the conversation after its opening line, as the source did -- a sidebar full of
    // "New conversation" is unusable once there is more than one.
    const conversation = this.conversations.getConversation(request.conversationId);
    if (conversation?.title === DEFAULT_CONVERSATION_TITLE) {
      this.conversations.renameConversation(
        request.conversationId,
        deriveTitle(request.userMessage)
      );
    }

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

      const message = this.conversations.appendMessage({
        conversationId: request.conversationId,
        role: 'assistant',
        content,
      });

      session.history.push({ role: 'user', content: request.userMessage });
      session.history.push({ role: 'assistant', content });
      if (session.history.length > historyLimit) {
        session.history = session.history.slice(-historyLimit);
      }

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

      if (request.extractMemories !== false) {
        // Deliberately not awaited: extraction is a second model call, and the source ran it
        // inline, adding roughly a second to every turn before the user saw anything. The
        // reply is already persisted and returned; new memories land when they land.
        void this.extract(request, built.prompt, content);
      }

      return { message, debug };
    } finally {
      // Always cleared, on success, error, and cancellation alike. The source left its
      // equivalent flag set when generation threw, which stuck the UI in "generating"
      // permanently with no way out but a restart.
      session.abort = null;
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

    const outcome = await retrieveMemories(this.ollama, query, candidates, options);

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
    request: GenerateRequest,
    systemPrompt: string,
    aiResponse: string
  ): Promise<ConversationMemory[]> {
    try {
      const existing = this.conversations.listMemories(request.conversationId);
      const facts = await extractMemories(this.ollama, request.model, {
        userMessage: request.userMessage,
        aiResponse,
        existingMemories: existing.map((memory) => memory.content),
        systemPrompt,
      });

      const added = facts.map((content) =>
        this.conversations.addMemory({
          conversationId: request.conversationId,
          content,
          source: 'auto',
        })
      );

      if (added.length > 0) this.onMemoriesExtracted?.(request.conversationId, added);
      return added;
    } catch {
      return [];
    }
  }
}
