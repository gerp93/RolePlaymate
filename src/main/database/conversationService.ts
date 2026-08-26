import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { Conversation, CreateConversationInput } from '../../shared/types/conversation';
import { Message, MessageRole } from '../../shared/types/message';
import {
  ConversationMemory,
  CreateMemoryInput,
  MemorySource,
} from '../../shared/types/conversationMemory';
import {
  UserPersona,
  CreateUserPersonaInput,
  UpdateUserPersonaInput,
} from '../../shared/types/userPersona';
import { transaction } from './schema';

const CONVERSATION_COLUMNS = `
  id,
  title,
  model,
  character_id as characterId,
  user_persona_id as userPersonaId,
  created_at as createdAt,
  updated_at as updatedAt
`;

const MESSAGE_COLUMNS = `
  id,
  conversation_id as conversationId,
  role,
  content,
  seq,
  created_at as createdAt
`;

const MEMORY_COLUMNS = `
  id,
  conversation_id as conversationId,
  content,
  source,
  created_at as createdAt
`;

const PERSONA_COLUMNS = `
  id,
  name,
  description,
  background,
  avatar,
  created_at as createdAt
`;

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    title: row.title as string,
    model: row.model as string,
    characterId: (row.characterId as string | null) ?? null,
    userPersonaId: (row.userPersonaId as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversationId: row.conversationId as string,
    role: row.role as MessageRole,
    content: row.content as string,
    seq: row.seq as number,
    createdAt: row.createdAt as string,
  };
}

function rowToMemory(row: Record<string, unknown>): ConversationMemory {
  return {
    id: row.id as string,
    conversationId: row.conversationId as string,
    content: row.content as string,
    source: row.source as MemorySource,
    createdAt: row.createdAt as string,
  };
}

function rowToPersona(row: Record<string, unknown>): UserPersona {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    background: (row.background as string | null) ?? null,
    avatar: (row.avatar as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

/** Titles are derived from the opening message when none is given; long ones are elided
 * rather than stored in full, since the title only ever appears in a list row. */
const TITLE_MAX_LENGTH = 60;

/** Placeholder until the first user message names the conversation. */
export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

export function deriveTitle(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ');
  if (!flat) return DEFAULT_CONVERSATION_TITLE;
  return flat.length <= TITLE_MAX_LENGTH ? flat : `${flat.slice(0, TITLE_MAX_LENGTH)}…`;
}

export class ConversationService {
  constructor(private db: DatabaseSync) {}

  // --- Conversations -------------------------------------------------------------------

  listConversations(limit = 100): Conversation[] {
    return this.db
      .prepare(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations ORDER BY updated_at DESC LIMIT ?`
      )
      .all(limit)
      .map(rowToConversation);
  }

  getConversation(id: string): Conversation | null {
    const row = this.db
      .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`)
      .get(id);
    return row ? rowToConversation(row) : null;
  }

  /**
   * Creates a conversation and, when `greeting` is non-empty, seeds it as the first
   * assistant message.
   *
   * The greeting is a real message row rather than a rendering special case: it belongs in
   * the model's context, in exports, and in the transcript the user can regenerate past.
   * The caller resolves it (PromptBuilder returns the character's active, macro-substituted
   * greeting) so this service stays purely about storage.
   */
  createConversation(input: CreateConversationInput & { greeting?: string }): Conversation {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO conversations (id, title, model, character_id, user_persona_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.title?.trim() || DEFAULT_CONVERSATION_TITLE,
          input.model,
          input.characterId,
          input.userPersonaId ?? null,
          now,
          now
        );

      if (input.greeting?.trim()) {
        this.appendMessage({ conversationId: id, role: 'assistant', content: input.greeting });
      }

      return this.getConversation(id)!;
    });
  }

  renameConversation(id: string, title: string): Conversation {
    const existing = this.getConversation(id);
    if (!existing) {
      throw new Error(`Conversation with id ${id} not found`);
    }
    this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, new Date().toISOString(), id);
    return this.getConversation(id)!;
  }

  /** Cascades to messages and memories via the schema's foreign keys. */
  deleteConversation(id: string): void {
    this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  }

  // --- Messages ------------------------------------------------------------------------

  /** Flat and ordered by `seq`. Deliberately not folded into (user, assistant) pairs the way
   * the source did -- that dropped system rows, consecutive user rows, and any trailing
   * unanswered user message. */
  getMessages(conversationId: string): Message[] {
    return this.db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? ORDER BY seq`)
      .all(conversationId)
      .map(rowToMessage);
  }

  getLastMessage(conversationId: string): Message | null {
    const row = this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT 1`
      )
      .get(conversationId);
    return row ? rowToMessage(row) : null;
  }

  /** Allocates `seq` and bumps the conversation's `updated_at` in one transaction, so two
   * concurrent appends can't claim the same slot (the unique index would reject the second). */
  appendMessage(input: { conversationId: string; role: MessageRole; content: string }): Message {
    const id = uuidv4();
    const now = new Date().toISOString();

    return transaction(this.db, () => {
      const { nextSeq } = this.db
        .prepare(
          `SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM messages WHERE conversation_id = ?`
        )
        .get(input.conversationId) as unknown as { nextSeq: number };

      this.db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, content, seq, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, input.conversationId, input.role, input.content, nextSeq, now);

      this.db
        .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
        .run(now, input.conversationId);

      return this.db
        .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`)
        .get(id) as unknown as Message;
    });
  }

  /**
   * Overwrites the newest assistant message in place.
   *
   * This is what regenerate uses. The source appended instead, so regenerating after a
   * response had been committed left the superseded reply in the database -- it vanished
   * from the visible transcript but stayed in the context sent to the model on later turns.
   *
   * Returns null when the conversation's last message isn't an assistant turn, so the caller
   * can fall back to appending rather than silently rewriting a user message.
   */
  replaceLastAssistantMessage(conversationId: string, content: string): Message | null {
    return transaction(this.db, () => {
      const last = this.getLastMessage(conversationId);
      if (!last || last.role !== 'assistant') return null;

      const now = new Date().toISOString();
      this.db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(content, last.id);
      this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);

      return this.db
        .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`)
        .get(last.id) as unknown as Message;
    });
  }

  // --- Memories ------------------------------------------------------------------------

  listMemories(conversationId: string): ConversationMemory[] {
    return this.db
      .prepare(
        `SELECT ${MEMORY_COLUMNS} FROM conversation_memories WHERE conversation_id = ? ORDER BY created_at`
      )
      .all(conversationId)
      .map(rowToMemory);
  }

  countMemories(conversationId: string): number {
    const row = this.db
      .prepare(`SELECT count(*) AS n FROM conversation_memories WHERE conversation_id = ?`)
      .get(conversationId) as unknown as { n: number };
    return row.n;
  }

  addMemory(input: CreateMemoryInput): ConversationMemory {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO conversation_memories (id, conversation_id, content, source, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, input.conversationId, input.content, input.source, new Date().toISOString());
    return this.db
      .prepare(`SELECT ${MEMORY_COLUMNS} FROM conversation_memories WHERE id = ?`)
      .get(id) as unknown as ConversationMemory;
  }

  /** Editing the text invalidates the cached embedding -- it described the old text. */
  updateMemory(id: string, content: string): ConversationMemory {
    this.db
      .prepare(
        `UPDATE conversation_memories SET content = ?, embedding = NULL, embedding_model = NULL WHERE id = ?`
      )
      .run(content, id);
    const row = this.db
      .prepare(`SELECT ${MEMORY_COLUMNS} FROM conversation_memories WHERE id = ?`)
      .get(id);
    if (!row) throw new Error(`Memory with id ${id} not found`);
    return rowToMemory(row);
  }

  deleteMemory(id: string): void {
    this.db.prepare(`DELETE FROM conversation_memories WHERE id = ?`).run(id);
  }

  deleteAllMemories(conversationId: string): void {
    this.db.prepare(`DELETE FROM conversation_memories WHERE conversation_id = ?`).run(conversationId);
  }

  // --- Personas ------------------------------------------------------------------------

  listPersonas(): UserPersona[] {
    return this.db.prepare(`SELECT ${PERSONA_COLUMNS} FROM user_personas ORDER BY name`).all().map(rowToPersona);
  }

  getPersona(id: string): UserPersona | null {
    const row = this.db.prepare(`SELECT ${PERSONA_COLUMNS} FROM user_personas WHERE id = ?`).get(id);
    return row ? rowToPersona(row) : null;
  }

  createPersona(input: CreateUserPersonaInput): UserPersona {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO user_personas (id, name, description, background, avatar, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        input.background ?? null,
        input.avatar ?? null,
        new Date().toISOString()
      );
    return this.getPersona(id)!;
  }

  updatePersona(id: string, input: UpdateUserPersonaInput): UserPersona {
    const existing = this.getPersona(id);
    if (!existing) {
      throw new Error(`UserPersona with id ${id} not found`);
    }
    this.db
      .prepare(
        `UPDATE user_personas SET name = ?, description = ?, background = ?, avatar = ? WHERE id = ?`
      )
      .run(
        input.name ?? existing.name,
        input.description ?? existing.description,
        input.background ?? existing.background,
        input.avatar ?? existing.avatar,
        id
      );
    return this.getPersona(id)!;
  }

  /** Conversations that used this persona keep their transcript; their `user_persona_id`
   * becomes NULL via the schema's ON DELETE SET NULL. */
  deletePersona(id: string): void {
    this.db.prepare(`DELETE FROM user_personas WHERE id = ?`).run(id);
  }
}
