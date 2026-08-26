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
    created_at TEXT NOT NULL
  );

  -- Doubles as the ordering index and as the guard against two messages claiming one slot.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq);

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
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memories_conv ON conversation_memories(conversation_id);
`;
