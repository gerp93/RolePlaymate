/**
 * Runs the library assistant: builds each request, lets the model call tools, stores everything,
 * and streams progress to the window.
 *
 * Like roleplay chat, `start` returns at once and everything else arrives as events on one channel,
 * and exactly one terminal event (done | error | cancelled) is always emitted -- including when the
 * model server is down or a tool throws -- so the UI can never be left "generating".
 *
 * The user's message is stored before the model is called (a crash cannot lose it); the model's
 * replies are stored only when they complete, so an error never leaves half a reply in the history.
 */
import { randomUUID } from 'crypto';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import {
  AssistantConversation,
  AssistantMessage,
  AssistantSettings,
  AssistantStreamEvent,
  AssistantToolCall,
} from '../../shared/types/assistant';
import { AssistantService, DEFAULT_ASSISTANT_TITLE } from '../database/assistantService';
import { OllamaAgentMessage, OllamaClient } from './ollamaClient';
import { estimateTokens } from './loreMatcher';
import { LibraryServices, loadLibrary } from './assistantLibrary';
import { ASSISTANT_TOOLS, executeTool } from './assistantTools';
import { buildAssistantSystemPrompt } from './assistantPrompt';
import { clip, oneLine } from './assistantText';

/** Model turns per message. Each tool call round is one turn; this stops a model that keeps calling
 * tools from running forever, while leaving room for read -> read -> read -> propose -> answer. */
export const MAX_TOOL_ROUNDS = 10;

/** Room kept for the model's answer and the tool definitions, which are sent with every request but
 * not counted in the messages. */
const RESERVED_TOKENS = 3000;

/** Tool results in turns before the latest are shortened: the model can read the item again if it
 * needs the detail, and a long conversation of full card dumps would crowd out the conversation. */
const OLD_TOOL_RESULT_CHARS = 600;

const TOOL_RESULT_MAX_CHARS = 12_000;

const TITLE_CHARS = 60;

/** An assistant tool-call message as Ollama wants it echoed back. */
function toOllama(message: AssistantMessage, shortenTool: boolean): OllamaAgentMessage {
  if (message.role === 'user') return { role: 'user', content: message.content };
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: shortenTool ? clip(message.content, OLD_TOOL_RESULT_CHARS) : message.content,
      tool_name: message.toolName ?? undefined,
    };
  }
  return {
    role: 'assistant',
    content: message.content,
    tool_calls: message.toolCalls?.map((call) => ({ function: { name: call.name, arguments: call.arguments } })),
  };
}

function messageTokens(message: AssistantMessage): number {
  const calls = message.toolCalls ? JSON.stringify(message.toolCalls).length : 0;
  return estimateTokens(message.content) + Math.ceil(calls / 4) + 4;
}

/**
 * The messages to send: the system prompt, then as many whole turns of history as fit.
 *
 * A turn starts at a user message and runs through the tool calls and replies that followed it.
 * History is cut between turns, never inside one -- a tool result whose call was dropped (or a call
 * whose result was) makes some models fail the request. The newest turn is always sent in full,
 * even over budget: it is the question being answered.
 */
export function buildRequestMessages(
  system: string,
  history: AssistantMessage[],
  contextWindow: number
): { messages: OllamaAgentMessage[]; droppedTurns: number } {
  const turns: AssistantMessage[][] = [];
  for (const message of history) {
    if (message.role === 'user' || turns.length === 0) turns.push([message]);
    else turns[turns.length - 1].push(message);
  }

  let budget = contextWindow - RESERVED_TOKENS - estimateTokens(system);
  const kept: AssistantMessage[][] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].reduce((sum, m) => sum + messageTokens(m), 0);
    if (i === turns.length - 1) {
      kept.unshift(turns[i]);
      budget -= cost;
    } else if (cost <= budget) {
      kept.unshift(turns[i]);
      budget -= cost;
    } else {
      break;
    }
  }

  const latest = kept.length - 1;
  const messages: OllamaAgentMessage[] = [{ role: 'system', content: system }];
  kept.forEach((turn, index) => {
    for (const message of turn) messages.push(toOllama(message, index !== latest));
  });
  return { messages, droppedTurns: turns.length - kept.length };
}

export class AssistantBusyError extends Error {
  constructor() {
    super('The assistant is already working on this conversation.');
  }
}

export class AssistantManager {
  private running = new Map<string, AbortController>();

  constructor(
    private store: AssistantService,
    private ollama: OllamaClient,
    private library: LibraryServices,
    private settings: () => AssistantSettings
  ) {}

  isRunning(conversationId: string): boolean {
    return this.running.has(conversationId);
  }

  cancel(conversationId: string): void {
    this.running.get(conversationId)?.abort();
  }

  /** A conversation that showed hidden content is itself hidden while the PIN is locked. */
  assertAccessible(conversation: AssistantConversation | null): AssistantConversation {
    if (!conversation || (conversation.touchedHidden && !this.library.security.isUnlocked())) {
      throw new Error('Assistant conversation not found.');
    }
    return conversation;
  }

  /**
   * Stores the user's message and starts the run in the background. Returns the stored message and
   * the id the events will carry. Throws for anything wrong before the run begins (no model chosen,
   * busy, hidden), so the caller can show it without a stream ever starting.
   */
  start(
    conversationId: string,
    content: string,
    emit: (event: AssistantStreamEvent) => void
  ): { streamId: string; userMessage: AssistantMessage } {
    const conversation = this.assertAccessible(this.store.getConversation(conversationId));
    const text = content.trim();
    if (!text) throw new Error('Type a message first.');
    if (text.length > FIELD_LIMITS.chatMessage) {
      throw new Error(`Message must be at most ${FIELD_LIMITS.chatMessage.toLocaleString()} characters`);
    }
    if (this.running.has(conversationId)) throw new AssistantBusyError();
    const model = conversation.model || this.settings().model;
    if (!model) throw new Error('Choose a model for the assistant first.');

    const userMessage = this.store.appendMessage({ conversationId, role: 'user', content: text });
    if (conversation.title === DEFAULT_ASSISTANT_TITLE) {
      this.store.renameConversation(conversationId, oneLine(text, TITLE_CHARS));
    }

    const controller = new AbortController();
    this.running.set(conversationId, controller);
    const streamId = randomUUID();
    void this.run(conversationId, model, streamId, controller, emit);
    return { streamId, userMessage };
  }

  private async run(
    conversationId: string,
    model: string,
    streamId: string,
    controller: AbortController,
    emit: (event: AssistantStreamEvent) => void
  ): Promise<void> {
    const send = (event: AssistantStreamEvent) => {
      try {
        emit(event);
      } catch {
        // The window may be gone; the run still has to finish and store what it did.
      }
    };
    try {
      const { contextWindow, styleGuide } = this.settings();

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const conversation = this.store.getConversation(conversationId);
        if (!conversation) {
          // Deleted mid-run. Still one terminal event, so nothing on screen is left "working".
          send({ type: 'cancelled', streamId, conversationId });
          return;
        }
        const system = buildAssistantSystemPrompt({ library: loadLibrary(this.library), styleGuide, notes: conversation.notes });
        const { messages } = buildRequestMessages(system, this.store.getMessages(conversationId), contextWindow);

        const result = await this.ollama.chatWithTools({
          model,
          messages,
          tools: ASSISTANT_TOOLS,
          options: { num_ctx: contextWindow, temperature: 0.6 },
          signal: controller.signal,
          onToken: (text) => send({ type: 'token', streamId, conversationId, text }),
        });

        const calls: AssistantToolCall[] = result.toolCalls.map((c) => ({ name: c.function.name, arguments: c.function.arguments }));
        const content = result.content.trim();

        if (calls.length === 0) {
          if (!content) {
            throw new Error(
              `${model} returned an empty reply. If it keeps happening, try another model -- the assistant needs one that supports tools.`
            );
          }
          const message = this.store.appendMessage({ conversationId, role: 'assistant', content });
          send({ type: 'message', streamId, conversationId, message });
          send({ type: 'done', streamId, conversationId });
          return;
        }

        const assistantMessage = this.store.appendMessage({ conversationId, role: 'assistant', content, toolCalls: calls });
        send({ type: 'message', streamId, conversationId, message: assistantMessage });
        send({ type: 'toolCalls', streamId, conversationId, calls });

        for (const call of calls) {
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          this.runTool(conversationId, streamId, call, send);
        }
      }

      const message = this.store.appendMessage({
        conversationId,
        role: 'assistant',
        content: `I stopped after ${MAX_TOOL_ROUNDS} rounds of looking things up without reaching an answer. Tell me to continue and I will pick up from what I have found.`,
      });
      send({ type: 'message', streamId, conversationId, message });
      send({ type: 'done', streamId, conversationId });
    } catch (error) {
      if (controller.signal.aborted) {
        send({ type: 'cancelled', streamId, conversationId });
      } else {
        send({ type: 'error', streamId, conversationId, message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      this.running.delete(conversationId);
    }
  }

  private runTool(
    conversationId: string,
    streamId: string,
    call: AssistantToolCall,
    send: (event: AssistantStreamEvent) => void
  ): void {
    let outcome;
    try {
      outcome = executeTool(call.name, call.arguments, loadLibrary(this.library));
    } catch (error) {
      // A tool bug must not end the run: the model can be told and try something else.
      outcome = { text: `Error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
    if (outcome.notes !== undefined) this.store.setNotes(conversationId, outcome.notes);
    if (outcome.touchedHidden) this.store.markTouchedHidden(conversationId);

    const message = this.store.appendMessage({
      conversationId,
      role: 'tool',
      content: clip(outcome.text, TOOL_RESULT_MAX_CHARS),
      toolName: call.name,
    });
    const proposal = outcome.proposal ? this.store.createProposal(conversationId, message.id, outcome.proposal) : null;
    send({ type: 'toolResult', streamId, conversationId, message, proposal });
  }
}
