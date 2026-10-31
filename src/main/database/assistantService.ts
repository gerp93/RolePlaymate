import type { DatabaseSync } from './sqlite';
import { v4 as uuidv4 } from 'uuid';
import {
  AssistantConversation,
  AssistantMessage,
  AssistantProposal,
  AssistantToolCall,
  CreatePayload,
  MAX_NOTES_CHARS,
  NewVersionPayload,
  ProposalEntity,
  ProposalStatus,
} from '../../shared/types/assistant';
import { transaction } from './schema';
import type { ProposalDraft } from '../chat/assistantTools';

const CONVERSATION_COLUMNS = `
  id, title, model, notes,
  touched_hidden as touchedHidden,
  created_at as createdAt, updated_at as updatedAt
`;

const MESSAGE_COLUMNS = `
  id, conversation_id as conversationId, seq, role, content,
  tool_calls as toolCalls, tool_name as toolName, created_at as createdAt
`;

const PROPOSAL_COLUMNS = `
  id, conversation_id as conversationId, message_id as messageId, action, entity, summary, payload,
  status, error, created_at as createdAt, resolved_at as resolvedAt
`;

function rowToConversation(row: Record<string, unknown>): AssistantConversation {
  return {
    id: row.id as string,
    title: row.title as string,
    model: row.model as string,
    notes: row.notes as string,
    touchedHidden: !!row.touchedHidden,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

function parseToolCalls(raw: unknown): AssistantToolCall[] | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AssistantToolCall[]) : null;
  } catch {
    return null;
  }
}

function rowToMessage(row: Record<string, unknown>): AssistantMessage {
  return {
    id: row.id as string,
    conversationId: row.conversationId as string,
    seq: row.seq as number,
    role: row.role as AssistantMessage['role'],
    content: row.content as string,
    toolCalls: parseToolCalls(row.toolCalls),
    toolName: (row.toolName as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

function rowToProposal(row: Record<string, unknown>): AssistantProposal {
  return {
    id: row.id as string,
    conversationId: row.conversationId as string,
    messageId: (row.messageId as string | null) ?? null,
    action: row.action as AssistantProposal['action'],
    entity: row.entity as ProposalEntity,
    summary: row.summary as string,
    payload: JSON.parse(row.payload as string) as NewVersionPayload | CreatePayload,
    status: row.status as ProposalStatus,
    error: (row.error as string | null) ?? null,
    createdAt: row.createdAt as string,
    resolvedAt: (row.resolvedAt as string | null) ?? null,
  };
}

export const DEFAULT_ASSISTANT_TITLE = 'New conversation';

/** Conversations, messages and proposals of the library assistant. Deleting a conversation deletes
 * only these rows; nothing it proposed or applied in the library is touched. */
export class AssistantService {
  constructor(private db: DatabaseSync) {}

  // --- conversations ---------------------------------------------------------------------

  /** While the PIN is locked, conversations that showed hidden content are left out entirely. */
  listConversations(unlocked: boolean): AssistantConversation[] {
    return this.db
      .prepare(
        `SELECT ${CONVERSATION_COLUMNS} FROM assistant_conversations ${unlocked ? '' : 'WHERE touched_hidden = 0'} ORDER BY updated_at DESC`
      )
      .all()
      .map(rowToConversation);
  }

  getConversation(id: string): AssistantConversation | null {
    const row = this.db.prepare(`SELECT ${CONVERSATION_COLUMNS} FROM assistant_conversations WHERE id = ?`).get(id);
    return row ? rowToConversation(row) : null;
  }

  createConversation(model: string, title = DEFAULT_ASSISTANT_TITLE): AssistantConversation {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO assistant_conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, title, model, now, now);
    return this.getConversation(id)!;
  }

  renameConversation(id: string, title: string): AssistantConversation {
    this.db
      .prepare(`UPDATE assistant_conversations SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title.trim() || DEFAULT_ASSISTANT_TITLE, new Date().toISOString(), id);
    return this.requireConversation(id);
  }

  setModel(id: string, model: string): AssistantConversation {
    this.db.prepare(`UPDATE assistant_conversations SET model = ? WHERE id = ?`).run(model, id);
    return this.requireConversation(id);
  }

  setNotes(id: string, notes: string): AssistantConversation {
    this.db
      .prepare(`UPDATE assistant_conversations SET notes = ?, updated_at = ? WHERE id = ?`)
      .run(notes.slice(0, MAX_NOTES_CHARS), new Date().toISOString(), id);
    return this.requireConversation(id);
  }

  markTouchedHidden(id: string): void {
    this.db.prepare(`UPDATE assistant_conversations SET touched_hidden = 1 WHERE id = ?`).run(id);
  }

  deleteConversation(id: string): void {
    this.db.prepare(`DELETE FROM assistant_conversations WHERE id = ?`).run(id);
  }

  private requireConversation(id: string): AssistantConversation {
    const conversation = this.getConversation(id);
    if (!conversation) throw new Error(`Assistant conversation ${id} not found`);
    return conversation;
  }

  // --- messages --------------------------------------------------------------------------

  getMessages(conversationId: string): AssistantMessage[] {
    return this.db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM assistant_messages WHERE conversation_id = ? ORDER BY seq`)
      .all(conversationId)
      .map(rowToMessage);
  }

  appendMessage(input: {
    conversationId: string;
    role: AssistantMessage['role'];
    content: string;
    toolCalls?: AssistantToolCall[] | null;
    toolName?: string | null;
  }): AssistantMessage {
    const id = uuidv4();
    const now = new Date().toISOString();
    return transaction(this.db, () => {
      const next =
        (this.db
          .prepare(`SELECT COALESCE(MAX(seq), 0) + 1 as next FROM assistant_messages WHERE conversation_id = ?`)
          .get(input.conversationId) as { next: number }).next;
      this.db
        .prepare(
          `INSERT INTO assistant_messages (id, conversation_id, seq, role, content, tool_calls, tool_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.conversationId,
          next,
          input.role,
          input.content,
          input.toolCalls && input.toolCalls.length > 0 ? JSON.stringify(input.toolCalls) : null,
          input.toolName ?? null,
          now
        );
      this.db.prepare(`UPDATE assistant_conversations SET updated_at = ? WHERE id = ?`).run(now, input.conversationId);
      return rowToMessage(this.db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM assistant_messages WHERE id = ?`).get(id)!);
    });
  }

  // --- proposals -------------------------------------------------------------------------

  createProposal(conversationId: string, messageId: string | null, draft: ProposalDraft): AssistantProposal {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO assistant_proposals (id, conversation_id, message_id, action, entity, summary, payload, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(id, conversationId, messageId, draft.action, draft.entity, draft.summary, JSON.stringify(draft.payload), new Date().toISOString());
    return this.getProposal(id)!;
  }

  getProposal(id: string): AssistantProposal | null {
    const row = this.db.prepare(`SELECT ${PROPOSAL_COLUMNS} FROM assistant_proposals WHERE id = ?`).get(id);
    return row ? rowToProposal(row) : null;
  }

  listProposals(conversationId: string): AssistantProposal[] {
    return this.db
      .prepare(`SELECT ${PROPOSAL_COLUMNS} FROM assistant_proposals WHERE conversation_id = ? ORDER BY created_at`)
      .all(conversationId)
      .map(rowToProposal);
  }

  setProposalStatus(id: string, status: ProposalStatus, error: string | null = null): AssistantProposal {
    this.db
      .prepare(`UPDATE assistant_proposals SET status = ?, error = ?, resolved_at = ? WHERE id = ?`)
      .run(status, error, status === 'pending' ? null : new Date().toISOString(), id);
    return this.getProposal(id)!;
  }
}
