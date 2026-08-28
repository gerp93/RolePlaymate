import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { Conversation, ConversationListItem, CreateConversationInput, ImageMode } from '../../shared/types/conversation';
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
import { SecurityService } from './securityService';
import { PersonaFieldVersionService } from './personaFieldVersionService';

const CONVERSATION_COLUMNS = `
  id,
  title,
  model,
  character_id as characterId,
  user_persona_id as userPersonaId,
  scenario_id as scenarioId,
  character_image_mode as characterImageMode,
  character_image_id as characterImageId,
  scenario_image_id as scenarioImageId,
  persona_image_mode as personaImageMode,
  persona_image_id as personaImageId,
  created_at as createdAt,
  updated_at as updatedAt
`;

const CONVERSATION_COLUMNS_FROM_C = `
  c.id,
  c.title,
  c.model,
  c.character_id as characterId,
  c.user_persona_id as userPersonaId,
  c.scenario_id as scenarioId,
  c.character_image_mode as characterImageMode,
  c.character_image_id as characterImageId,
  c.scenario_image_id as scenarioImageId,
  c.persona_image_mode as personaImageMode,
  c.persona_image_id as personaImageId,
  c.created_at as createdAt,
  c.updated_at as updatedAt
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

// background comes from the active persona_background_versions row, not the (now legacy-only)
// user_personas.background column -- see PersonaFieldVersionService. Every query selecting
// these columns must join persona_background_versions the same way (see PERSONA_FROM below).
const PERSONA_COLUMNS = `
  up.id as id,
  up.name as name,
  up.description as description,
  pbv.content as background,
  up.avatar as avatar,
  up.is_hidden as isHidden,
  up.created_at as createdAt
`;

const PERSONA_FROM = `
  user_personas up
  LEFT JOIN persona_background_versions pbv ON pbv.persona_id = up.id AND pbv.is_active = 1
`;

function rowToConversationListItem(
  row: Record<string, unknown>,
  security: SecurityService
): ConversationListItem {
  const conversation = rowToConversation(row);
  const scenarioNameRaw = row.scenarioName as string | null | undefined;
  const scenarioIsHidden = !!row.scenarioIsHidden;
  return {
    ...conversation,
    messageCount: Number(row.messageCount ?? 0),
    userMessageCount: Number(row.userMessageCount ?? 0),
    lastMessageAt: (row.lastMessageAt as string | null) ?? null,
    scenarioName:
      scenarioNameRaw == null
        ? null
        : security.decryptIfHidden(scenarioNameRaw, scenarioIsHidden),
  };
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    title: row.title as string,
    model: row.model as string,
    characterId: (row.characterId as string | null) ?? null,
    userPersonaId: (row.userPersonaId as string | null) ?? null,
    scenarioId: (row.scenarioId as string | null) ?? null,
    characterImageMode: row.characterImageMode as ImageMode,
    characterImageId: (row.characterImageId as string | null) ?? null,
    scenarioImageId: (row.scenarioImageId as string | null) ?? null,
    personaImageMode: row.personaImageMode as ImageMode,
    personaImageId: (row.personaImageId as string | null) ?? null,
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


/** Stored but no longer surfaced anywhere -- the renderer displays character/persona names
 * instead (see Chat.tsx). Kept as a fixed value rather than removing the column/NOT NULL
 * constraint, since nothing reads it now. */
export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

/** A conversation that only has the seeded opening greeting -- not yet started by the user.
 * Continue-only threads (many assistant turns, zero user rows) are committed, not drafts. */
const GREETING_ONLY_DRAFT_WHERE = `
  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) = 1
  AND NOT EXISTS (
    SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user'
  )
`;

export class ConversationService {
  constructor(
    private db: DatabaseSync,
    private security: SecurityService,
    private personaFieldVersions: PersonaFieldVersionService
  ) {}

  /** Decrypts name/description/background when the persona is hidden -- same convention as
   * CharacterService.rowToCharacter. */
  private rowToPersona(row: Record<string, unknown>): UserPersona {
    const isHidden = !!row.isHidden;
    const description = row.description as string | null;
    const background = row.background as string | null;
    return {
      id: row.id as string,
      name: this.security.decryptIfHidden(row.name as string, isHidden),
      description: description == null ? null : this.security.decryptIfHidden(description, isHidden),
      background: background == null ? null : this.security.decryptIfHidden(background, isHidden),
      avatar: (row.avatar as string | null) ?? null,
      isHidden,
      createdAt: row.createdAt as string,
    };
  }

  // --- Conversations -------------------------------------------------------------------

  listConversations(limit = 100): ConversationListItem[] {
    return this.db
      .prepare(
        `SELECT
           ${CONVERSATION_COLUMNS_FROM_C},
           s.name AS scenarioName,
           s.is_hidden AS scenarioIsHidden,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS userMessageCount,
           (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS lastMessageAt
         FROM conversations c
         LEFT JOIN scenarios s ON s.id = c.scenario_id
         WHERE NOT (${GREETING_ONLY_DRAFT_WHERE})
         ORDER BY COALESCE(lastMessageAt, c.updated_at) DESC
         LIMIT ?`
      )
      .all(limit)
      .map((row) => rowToConversationListItem(row, this.security));
  }

  isDraftConversation(conversationId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS userCount
         FROM messages WHERE conversation_id = ?`
      )
      .get(conversationId) as { total: number; userCount: number | null };
    return row.total === 1 && (row.userCount ?? 0) === 0;
  }

  /** Drops a conversation that only has the seeded opening greeting. */
  deleteDraftConversation(id: string): boolean {
    if (!this.isDraftConversation(id)) return false;
    this.deleteConversation(id);
    return true;
  }

  /** Drops every greeting-only draft. Pass `exceptConversationId` to keep the one the user
   * is currently viewing. */
  purgeDraftConversations(exceptConversationId?: string | null): string[] {
    const rows = (
      exceptConversationId
        ? this.db.prepare(
            `SELECT c.id FROM conversations c
             WHERE ${GREETING_ONLY_DRAFT_WHERE}
             AND c.id != ?`
          ).all(exceptConversationId)
        : this.db.prepare(`SELECT c.id FROM conversations c WHERE ${GREETING_ONLY_DRAFT_WHERE}`).all()
    ) as { id: string }[];

    for (const row of rows) {
      this.deleteConversation(row.id);
    }
    return rows.map((row) => row.id);
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
    const scenarioId = input.scenarioId ?? null;
    const defaultImage = this.resolveDefaultImageForScenario(scenarioId);

    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO conversations
             (id, title, model, character_id, user_persona_id, scenario_id,
              character_image_mode, character_image_id, scenario_image_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.title?.trim() || DEFAULT_CONVERSATION_TITLE,
          input.model,
          input.characterId,
          input.userPersonaId ?? null,
          scenarioId,
          defaultImage.mode,
          defaultImage.characterImageId,
          defaultImage.scenarioImageId,
          now,
          now
        );

      if (input.greeting?.trim()) {
        this.appendMessage({ conversationId: id, role: 'assistant', content: input.greeting });
      }

      return this.getConversation(id)!;
    });
  }

  /** Which specific portrait shows in the transcript is purely cosmetic -- unlike character/
   * persona selection (locked once a conversation has messages, see Chat.tsx's
   * selectionLocked), this can be changed at any point in a conversation's life since it never
   * touches the model's context. Any field omitted here is left as-is. */
  setImageMode(
    id: string,
    input: {
      characterImageMode?: ImageMode;
      characterImageId?: string | null;
      scenarioImageId?: string | null;
      personaImageMode?: ImageMode;
      personaImageId?: string | null;
    }
  ): Conversation {
    const existing = this.getConversation(id);
    if (!existing) {
      throw new Error(`Conversation with id ${id} not found`);
    }
    this.db
      .prepare(
        `UPDATE conversations
         SET character_image_mode = ?, character_image_id = ?, scenario_image_id = ?,
             persona_image_mode = ?, persona_image_id = ?
         WHERE id = ?`
      )
      .run(
        input.characterImageMode ?? existing.characterImageMode,
        input.characterImageId !== undefined ? input.characterImageId : existing.characterImageId,
        input.scenarioImageId !== undefined ? input.scenarioImageId : existing.scenarioImageId,
        input.personaImageMode ?? existing.personaImageMode,
        input.personaImageId !== undefined ? input.personaImageId : existing.personaImageId,
        id
      );
    return this.getConversation(id)!;
  }

  /** `characterImageId`/`scenarioImageId` pin the same character-side portrait slot, so picking
   * a new scenario resolves a fresh default for both rather than leaving a stale character-side
   * pick sitting alongside the new scenario's own images. Used by createConversation and
   * setConversationScenario, which is why it returns full column values rather than the
   * "omitted = keep existing" partial shape setImageMode takes. */
  private resolveDefaultImageForScenario(scenarioId: string | null): {
    mode: ImageMode;
    characterImageId: string | null;
    scenarioImageId: string | null;
  } {
    if (scenarioId) {
      const cover = this.db
        .prepare(`SELECT id FROM scenario_images WHERE scenario_id = ? ORDER BY position LIMIT 1`)
        .get(scenarioId) as { id: string } | undefined;
      if (cover) {
        return { mode: 'static', characterImageId: null, scenarioImageId: cover.id };
      }
    }
    return { mode: 'carousel', characterImageId: null, scenarioImageId: null };
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

  /** Lets the user-side persona change mid-conversation (one person stepping away, another
   * taking their place) without disturbing history -- past messages and memories already hold
   * literal text, not a {{user}} placeholder, so nothing about them changes; only the next
   * turn's freshly-built system prompt picks up the new persona. Resets the persona image
   * selection since a static pick belonged to whoever was previously selected here. */
  setConversationPersona(id: string, userPersonaId: string | null): Conversation {
    const existing = this.getConversation(id);
    if (!existing) {
      throw new Error(`Conversation with id ${id} not found`);
    }
    this.db
      .prepare(
        `UPDATE conversations SET user_persona_id = ?, persona_image_mode = 'carousel', persona_image_id = NULL WHERE id = ?`
      )
      .run(userPersonaId, id);
    return this.getConversation(id)!;
  }

  /** Same idea as setConversationPersona, for the character-side scenario. Unlike persona's
   * reset-to-carousel, this seeds the character-side image pick from the new scenario's own
   * cover image when it has one (see resolveDefaultImageForScenario) -- a scenario's image is
   * meant to become the default shown once that scenario is selected, not just clear whatever
   * was picked before. */
  setConversationScenario(id: string, scenarioId: string | null): Conversation {
    const existing = this.getConversation(id);
    if (!existing) {
      throw new Error(`Conversation with id ${id} not found`);
    }
    const defaultImage = this.resolveDefaultImageForScenario(scenarioId);
    this.db
      .prepare(
        `UPDATE conversations
         SET scenario_id = ?, character_image_mode = ?, character_image_id = ?, scenario_image_id = ?
         WHERE id = ?`
      )
      .run(scenarioId, defaultImage.mode, defaultImage.characterImageId, defaultImage.scenarioImageId, id);
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
    const first = this.db
      .prepare(`SELECT id, role FROM messages WHERE conversation_id = ? ORDER BY seq ASC LIMIT 1`)
      .get(conversationId) as { id: string; role: MessageRole } | undefined;
    if (first?.id === messageId && first.role === 'assistant') {
      throw new Error('The opening greeting cannot be deleted');
    }
    this.db.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);
  }

  /** Updates a message's stored text in place -- unlike appendMessage, doesn't touch `seq` or
   * role, and unlike the assistant-side edit flow (message_variants), keeps no history of
   * prior text: this is for correcting the user's own words, not swapping between AI
   * generations. Callers decide which messages are safe to touch this way -- see
   * ChatSessionManager.editPriorUserMessage, currently the only caller. */
  updateMessageContent(id: string, content: string): Message {
    this.db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(content, id);
    const message = this.getMessage(id);
    if (!message) throw new Error(`Message with id ${id} not found`);
    return message;
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
    return this.db
      .prepare(`SELECT ${PERSONA_COLUMNS} FROM ${PERSONA_FROM} ORDER BY up.name`)
      .all()
      .map((r) => this.rowToPersona(r));
  }

  getPersona(id: string): UserPersona | null {
    const row = this.db.prepare(`SELECT ${PERSONA_COLUMNS} FROM ${PERSONA_FROM} WHERE up.id = ?`).get(id);
    return row ? this.rowToPersona(row) : null;
  }

  /** `background` is not written to the `user_personas` column (unused going forward, see
   * PERSONA_COLUMNS) -- it seeds the persona's first background version instead, same
   * transaction, matching how a character's fields get their own version 1 at creation. */
  createPersona(input: CreateUserPersonaInput): UserPersona {
    const id = uuidv4();
    return transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO user_personas (id, name, description, avatar, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, input.name, input.description ?? null, input.avatar ?? null, new Date().toISOString());
      this.personaFieldVersions.createVersion(id, input.background ?? '');
      return this.getPersona(id)!;
    });
  }

  /** Clones a persona's name (suffixed), description and background. Gallery images are the
   * caller's responsibility (see characters:clone in main.ts for why -- file writes aren't
   * transactional, so copying image files happens outside any DB transaction, in a loop over
   * personaImageService after this returns). */
  clonePersona(id: string): UserPersona {
    const source = this.getPersona(id);
    if (!source) throw new Error(`UserPersona with id ${id} not found`);

    return this.createPersona({
      name: `${source.name} (Copy)`,
      description: source.description ?? undefined,
      background: source.background ?? undefined,
    });
  }

  /** `background` can no longer be set here -- only through personaFieldVersions:* (create a
   * new version, same as a character field). */
  updatePersona(id: string, input: UpdateUserPersonaInput): UserPersona {
    const existing = this.getPersona(id);
    if (!existing) {
      throw new Error(`UserPersona with id ${id} not found`);
    }
    const name = input.name ?? existing.name;
    const description = input.description ?? existing.description;
    this.db
      .prepare(`UPDATE user_personas SET name = ?, description = ?, avatar = ? WHERE id = ?`)
      .run(
        this.security.encryptIfHidden(name, existing.isHidden),
        description == null ? null : this.security.encryptIfHidden(description, existing.isHidden),
        input.avatar ?? existing.avatar,
        id
      );
    return this.getPersona(id)!;
  }

  /** Same shape as CharacterService.setHidden: `existing` is already plaintext (decrypted if
   * currently hidden, since getPersona requires unlock to have decrypted it -- checked below
   * for both directions), so hide encrypts it under the new flag and unhide just flips the
   * flag back to plain columns. `background`'s own versions are cascaded separately via
   * personaFieldVersions.setHiddenForPersona, same convention as
   * CharacterService.setHidden -> FieldVersionService.setHiddenForCharacter. */
  setPersonaHidden(id: string, hidden: boolean): UserPersona {
    const existing = this.getPersona(id);
    if (!existing) {
      throw new Error(`UserPersona with id ${id} not found`);
    }
    if (!this.security.isUnlocked()) {
      throw new Error('Unlock with the PIN before hiding or unhiding an item');
    }

    const name = hidden ? this.security.encrypt(existing.name) : existing.name;
    const description =
      existing.description == null
        ? null
        : hidden
          ? this.security.encrypt(existing.description)
          : existing.description;

    return transaction(this.db, () => {
      this.db
        .prepare(`UPDATE user_personas SET name = ?, description = ?, is_hidden = ? WHERE id = ?`)
        .run(name, description, hidden ? 1 : 0, id);
      this.personaFieldVersions.setHiddenForPersona(id, hidden);
      return this.getPersona(id)!;
    });
  }

  /** PIN-change rekey for every currently-hidden persona's name/description. `background`'s
   * versions are rekeyed separately -- see personaFieldVersions.reencryptHiddenContent. */
  reencryptHiddenPersonaContent(oldKey: Buffer, newKey: Buffer): void {
    const rows = this.db
      .prepare(`SELECT id, name, description FROM user_personas WHERE is_hidden = 1`)
      .all() as { id: string; name: string; description: string | null }[];

    const stmt = this.db.prepare(`UPDATE user_personas SET name = ?, description = ? WHERE id = ?`);
    for (const row of rows) {
      const name = this.security.reencryptWithKeys(row.name, oldKey, newKey);
      const description =
        row.description == null ? null : this.security.reencryptWithKeys(row.description, oldKey, newKey);
      stmt.run(name, description, row.id);
    }
  }

  /** After a successful unlock, upgrades any hidden persona's name/description still sitting
   * in legacy plaintext to real ciphertext. `background`'s versions are migrated separately --
   * see personaFieldVersions.migrateLegacyHiddenContent. */
  migrateLegacyHiddenPersonaContent(): void {
    const rows = this.db
      .prepare(`SELECT id, name, description FROM user_personas WHERE is_hidden = 1`)
      .all() as { id: string; name: string; description: string | null }[];

    const stmt = this.db.prepare(`UPDATE user_personas SET name = ?, description = ? WHERE id = ?`);
    for (const row of rows) {
      const name = this.security.migrateLegacyContent(row.name, true);
      const description = row.description == null ? null : this.security.migrateLegacyContent(row.description, true);
      if (name !== row.name || description !== row.description) {
        stmt.run(name, description, row.id);
      }
    }
  }

  /** Conversations that used this persona keep their transcript; their `user_persona_id`
   * becomes NULL via the schema's ON DELETE SET NULL. */
  deletePersona(id: string): void {
    this.db.prepare(`DELETE FROM user_personas WHERE id = ?`).run(id);
  }
}
