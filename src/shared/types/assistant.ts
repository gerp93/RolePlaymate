/**
 * Shapes for the library assistant: a free-form chat (separate from roleplay chat) with a local
 * Ollama model that can read the character/persona/scenario library and PROPOSE changes to it.
 * The model never writes directly -- every change is a proposal the user applies or rejects, and
 * applying one adds a new version (or a new item), so nothing is ever overwritten.
 */

/** Which library entity a proposal is about. */
export type ProposalEntity = 'character' | 'persona' | 'scenario';

/** Which versioned text of that entity. `personality`/`dialogue` belong to a character,
 * `background` to a persona, `content`/`greeting` to a scenario. */
export type ProposalField = 'personality' | 'dialogue' | 'background' | 'content' | 'greeting';

export const FIELDS_BY_ENTITY: Record<ProposalEntity, ProposalField[]> = {
  character: ['personality', 'dialogue'],
  persona: ['background'],
  scenario: ['content', 'greeting'],
};

export const PROPOSAL_FIELD_LABELS: Record<ProposalField, string> = {
  personality: 'Personality',
  dialogue: 'Example dialogue',
  background: 'Background',
  content: 'Scenario text',
  greeting: 'Opening greeting',
};

/** A new version of one existing text. `before` is the active text when the proposal was made. */
export interface NewVersionPayload {
  entity: ProposalEntity;
  entityId: string;
  entityName: string;
  field: ProposalField;
  before: string;
  after: string;
}

/** A brand-new character, persona or scenario. A scenario is owned by exactly one character OR one
 * group, named by `ownerCharacterId` / `ownerGroupId`. */
export interface CreatePayload {
  entity: ProposalEntity;
  name: string;
  description: string;
  fields: Partial<Record<ProposalField, string>>;
  ownerCharacterId?: string;
  ownerGroupId?: string;
  ownerName?: string;
}

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed';

export interface AssistantProposal {
  id: string;
  conversationId: string;
  /** The tool-result message the proposal was made in, so the transcript can show it there. */
  messageId: string | null;
  action: 'newVersion' | 'create';
  entity: ProposalEntity;
  summary: string;
  payload: NewVersionPayload | CreatePayload;
  status: ProposalStatus;
  /** Why an apply failed (limits, the target was deleted since, ...). */
  error: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AssistantConversation {
  id: string;
  title: string;
  model: string;
  /** Working notes: decisions and the current direction, shown to the model on every turn. The
   * user can edit them and the model can update them, so they survive history being trimmed. */
  notes: string;
  /** Set once a tool returned hidden content in this conversation -- the conversation is then
   * hidden itself while the PIN is locked. */
  touchedHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AssistantMessage {
  id: string;
  conversationId: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** Tools an assistant message asked for (null when it asked for none). */
  toolCalls: AssistantToolCall[] | null;
  /** For role 'tool': which tool produced this result. */
  toolName: string | null;
  createdAt: string;
}

export interface AssistantSendRequest {
  conversationId: string;
  content: string;
}

/** Pushed on the single `assistant:stream` channel, like roleplay chat's `chat:stream`. Exactly one
 * terminal event (`done` | `error` | `cancelled`) per send. */
export type AssistantStreamEvent =
  | { type: 'token'; streamId: string; conversationId: string; text: string }
  /** A model turn finished and asked for tools; they are about to run. */
  | { type: 'toolCalls'; streamId: string; conversationId: string; calls: AssistantToolCall[] }
  /** A tool finished; the stored message (and proposal, if it made one) are included. */
  | { type: 'toolResult'; streamId: string; conversationId: string; message: AssistantMessage; proposal: AssistantProposal | null }
  /** The model's text for this turn is complete and stored. */
  | { type: 'message'; streamId: string; conversationId: string; message: AssistantMessage }
  | { type: 'done'; streamId: string; conversationId: string }
  | { type: 'error'; streamId: string; conversationId: string; message: string }
  | { type: 'cancelled'; streamId: string; conversationId: string };

export interface AssistantSettings {
  /** Ollama model used by the assistant. Empty until the user picks one. */
  model: string;
  /** Context window requested for assistant calls (tokens). Separate from roleplay chat's. */
  contextWindow: number;
  /** The user's own house style for cards, given to the model as guidance for the form they want. */
  styleGuide: string;
}

export const DEFAULT_ASSISTANT_CONTEXT_WINDOW = 16384;
export const MIN_ASSISTANT_CONTEXT_WINDOW = 4096;
export const MAX_ASSISTANT_CONTEXT_WINDOW = 131072;
export const MAX_STYLE_GUIDE_CHARS = 4000;
export const MAX_NOTES_CHARS = 3000;
