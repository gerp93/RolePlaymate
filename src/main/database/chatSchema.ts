/**
 * Schema for the chat feature, kept separate from schema.ts so the character-library DDL
 * stays readable. Applied by initDatabase alongside the core tables.
 *
 * Ported from KVGenius's chat_history.py, with four deliberate departures -- each fixing a
 * bug in the original rather than reproducing it:
 *
 *  1. TEXT uuid keys, not INTEGER AUTOINCREMENT. Matches every existing table here, and
 *     conversations.character_id has to be a TEXT foreign key into characters(id) anyway.
 *  2. messages.seq for ordering, not a timestamp. The original ordered by a
 *     second-granularity timestamp, so two messages in the same second could come back
 *     swapped.
 *  3. Real ON DELETE CASCADE. The original never enabled foreign keys, so deleting a
 *     conversation orphaned its messages and memories forever.
 *  4. An embedding cache column, so memory retrieval embeds the query once per turn instead
 *     of re-embedding every stored memory every turn.
 *
 * Note conversations.character_id is ON DELETE SET NULL, not CASCADE: deleting a character
 * shouldn't silently destroy the chat logs that mention it. Such a conversation keeps its
 * transcript and becomes a read-only historical record.
 */
export const CHAT_DDL = `
  CREATE TABLE IF NOT EXISTS user_personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    background TEXT,
    avatar TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
    user_persona_id TEXT REFERENCES user_personas(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_conversations_character ON conversations(character_id);

  -- A flat, ordered message list. The source folded rows into (user, assistant) pairs on
  -- read, which silently dropped system rows, consecutive user rows, and any trailing
  -- unanswered user message.
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    seq INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    -- Which variant "content" currently mirrors. Only assistant messages have variants; see
    -- message_variants below. Nullable because it references a table created after this one.
    selected_variant_id TEXT REFERENCES message_variants(id) ON DELETE SET NULL,
    -- Mirrors the selected variant's model, same convention as content -- lets the transcript
    -- show which model produced a reply without a join for every message in the list.
    model TEXT
  );

  -- Doubles as the ordering index and as the guard against two messages claiming one slot.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq);

  -- Redo/swipe candidates for one assistant message. The first response is variant #1 same
  -- as any redo -- there is no special case for "the original". messages.content always
  -- mirrors whichever variant is selected, so every existing read of a message's content
  -- keeps working unchanged; this table only adds the ability to have more than one and to
  -- navigate between them.
  CREATE TABLE IF NOT EXISTS message_variants (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    -- The model that generated this variant. Redoing with a different model selected produces
    -- a variant with its own model, independent of the message's other variants.
    model TEXT,
    -- The full ChatDebugInfo for this variant's turn, JSON-serialized -- what "view prompt"
    -- reads. Stored per variant, not per message, because each redo is its own turn with its
    -- own prompt and its own response; there is no single "the" prompt for a message that's
    -- been redone.
    debug TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_message_variants_message ON message_variants(message_id);

  -- Facts worth remembering across a long conversation. 'auto' rows are model-extracted
  -- after a turn; 'manual' rows are user-written and are always injected regardless of
  -- retrieval score. \`embedding\` caches the float32 vector; \`embedding_model\` records which
  -- model produced it, so changing models invalidates the cache instead of silently
  -- comparing vectors from different embedding spaces.
  CREATE TABLE IF NOT EXISTS conversation_memories (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    embedding BLOB,
    embedding_model TEXT,
    created_at TEXT NOT NULL,
    -- Which turn this was extracted from, so deleting that message takes its memories with
    -- it. Null for manually-added memories (never extracted from any one turn) and for rows
    -- written before this column existed.
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_memories_conv ON conversation_memories(conversation_id);
`;
