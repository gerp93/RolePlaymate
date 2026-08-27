import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { Conversation, CreateConversationInput } from '../../shared/types/conversation';
import { Message, MessageRole, MessageVariant } from '../../shared/types/message';
import { ChatDebugInfo } from '../../shared/types/chat';
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
  selected_variant_id as selectedVariantId,
  model,
  seq,
  created_at as createdAt
`;

const VARIANT_COLUMNS = `
  id,
  message_id as messageId,
  content,
  model,
  created_at as createdAt
`;

const MEMORY_COLUMNS = `
  id,
  conversation_id as conversationId,
  content,
  source,
  message_id as messageId,
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
    selectedVariantId: (row.selectedVariantId as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    seq: row.seq as number,
    createdAt: row.createdAt as string,
  };
}

function rowToVariant(row: Record<string, unknown>): MessageVariant {
  return {
    id: row.id as string,
    messageId: row.messageId as string,
    content: row.content as string,
    model: (row.model as string | null) ?? null,
    createdAt: row.createdAt as string,
  };
}

function rowToMemory(row: Record<string, unknown>): ConversationMemory {
  return {
    id: row.id as string,
    conversationId: row.conversationId as string,
    content: row.content as string,
    source: row.source as MemorySource,
    messageId: (row.messageId as string | null) ?? null,
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

  /** The model can change freely mid-conversation -- each turn already carries its own model
   * to generate.chat, this just keeps the conversation record (and the sidebar) showing
   * whichever one was used most recently rather than freezing on the one it started with. */
  updateConversationModel(id: string, model: string): void {
    this.db.prepare(`UPDATE conversations SET model = ? WHERE id = ?`).run(model, id);
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

  /**
   * Deletes one message, LIFO only: it must be the conversation's current last message.
   * Anything earlier can only go by deleting everything after it first, one at a time -- the
   * transcript is a stack, not a list you can pick holes in.
   *
   * Variants (message_variants) and any memories extracted from this turn
   * (conversation_memories.message_id) cascade with it via the schema's foreign keys, so a
   * deleted response can't keep influencing the conversation through a memory it produced.
   */
  deleteMessage(conversationId: string, messageId: string): void {
    const last = this.getLastMessage(conversationId);
    if (!last || last.id !== messageId) {
      throw new Error('Only the most recent message can be deleted');
    }
    this.db.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);
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

  getMessage(id: string): Message | null {
    const row = this.db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`).get(id);
    return row ? rowToMessage(row) : null;
  }

  /** Appends an assistant message and immediately gives it its first variant, selected. Every
   * assistant message has at least one variant this way -- there's no special case downstream
   * for "a message with no variants yet" vs. "a message that's been redone". */
  appendAssistantMessage(
    conversationId: string,
    content: string,
    model: string,
    debug: ChatDebugInfo
  ): { message: Message; variant: MessageVariant } {
    return transaction(this.db, () => {
      const message = this.appendMessage({ conversationId, role: 'assistant', content });
      const variant = this.addVariant(message.id, content, model, debug);
      const selected = this.selectVariant(message.id, variant.id);
      return { message: selected, variant };
    });
  }

  // --- Redo / swipe variants -------------------------------------------------------------

  getVariants(messageId: string): MessageVariant[] {
    return this.db
      .prepare(`SELECT ${VARIANT_COLUMNS} FROM message_variants WHERE message_id = ? ORDER BY created_at`)
      .all(messageId)
      .map(rowToVariant);
  }

  /**
   * The logged prompt and prompt pieces for one message -- whatever the currently selected
   * variant's turn actually sent and got back. Read on demand rather than joined into every
   * message list: it's a full ChatDebugInfo (system prompt, retrieval, lore, ...), too heavy
   * to carry along for every row when just listing a transcript.
   */
  getVariantDebug(messageId: string): ChatDebugInfo | null {
    const row = this.db
      .prepare(
        `SELECT v.debug FROM messages m
         JOIN message_variants v ON v.id = m.selected_variant_id
         WHERE m.id = ?`
      )
      .get(messageId) as unknown as { debug: string | null } | undefined;
    if (!row?.debug) return null;
    return JSON.parse(row.debug) as ChatDebugInfo;
  }

  /** Records a new redo candidate without changing which one is currently shown -- the caller
   * (chatSession.regenerate) selects it separately once generation succeeds, so a failed or
   * cancelled redo never disturbs what's on screen. */
  addVariant(messageId: string, content: string, model?: string, debug?: ChatDebugInfo): MessageVariant {
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO message_variants (id, message_id, content, model, debug, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, messageId, content, model ?? null, debug ? JSON.stringify(debug) : null, new Date().toISOString());
    const row = this.db.prepare(`SELECT ${VARIANT_COLUMNS} FROM message_variants WHERE id = ?`).get(id);
    return rowToVariant(row!);
  }

  /** Makes a variant the one shown -- updates the message's own `content` and `model` to
   * match, so every existing reader (the transcript, the model context once this turn is
   * finalized) sees it without needing to know variants exist. */
  selectVariant(messageId: string, variantId: string): Message {
    return transaction(this.db, () => {
      const row = this.db
        .prepare(`SELECT ${VARIANT_COLUMNS} FROM message_variants WHERE id = ? AND message_id = ?`)
        .get(variantId, messageId);
      if (!row) throw new Error(`Variant ${variantId} not found on message ${messageId}`);
      const variant = rowToVariant(row);

      this.db
        .prepare(`UPDATE messages SET content = ?, model = ?, selected_variant_id = ? WHERE id = ?`)
        .run(variant.content, variant.model, variantId, messageId);

      return this.getMessage(messageId)!;
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
        `INSERT INTO conversation_memories (id, conversation_id, content, source, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.conversationId,
        input.content,
        input.source,
        input.messageId ?? null,
        new Date().toISOString()
      );
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

  // --- Embedding cache -----------------------------------------------------------------

  /**
   * Memories plus whatever embedding is cached for each.
   *
   * The vector is stored as raw float32 bytes rather than JSON: a 768-dimension embedding is
   * 3 KB packed and roughly 15 KB as text, and every one of them is read on every turn.
   * `embedding_model` rides alongside because a vector from a different model lives in a
   * different space -- comparing across them yields confident nonsense, so the retriever
   * recomputes those instead of trusting them.
   */
  listMemoriesWithEmbeddings(
    conversationId: string
  ): { memory: ConversationMemory; embedding: Uint8Array | null; embeddingModel: string | null }[] {
    return this.db
      .prepare(
        `SELECT ${MEMORY_COLUMNS}, embedding, embedding_model as embeddingModel
           FROM conversation_memories WHERE conversation_id = ? ORDER BY created_at`
      )
      .all(conversationId)
      .map((row) => ({
        memory: rowToMemory(row),
        embedding: (row.embedding as Uint8Array | null) ?? null,
        embeddingModel: (row.embeddingModel as string | null) ?? null,
      }));
  }

  /** Write-back after a retrieval pass computed vectors for previously uncached memories. */
  setMemoryEmbeddings(
    entries: { memoryId: string; embedding: Uint8Array; embeddingModel: string }[]
  ): void {
    if (entries.length === 0) return;
    transaction(this.db, () => {
      const stmt = this.db.prepare(
        `UPDATE conversation_memories SET embedding = ?, embedding_model = ? WHERE id = ?`
      );
      for (const entry of entries) {
        stmt.run(entry.embedding, entry.embeddingModel, entry.memoryId);
      }
    });
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

  /** Clones a persona's name (suffixed), description and background. `clonedAvatarPath` is
   * the caller's responsibility (see characters:clone in main.ts for why -- file writes
   * aren't transactional, so copying the avatar file happens outside any DB transaction). */
  clonePersona(id: string, clonedAvatarPath: string | null): UserPersona {
    const source = this.getPersona(id);
    if (!source) throw new Error(`UserPersona with id ${id} not found`);

    return this.createPersona({
      name: `${source.name} (Copy)`,
      description: source.description ?? undefined,
      background: source.background ?? undefined,
      avatar: clonedAvatarPath ?? undefined,
    });
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
