/**
 * Schema for the library assistant, kept apart from the roleplay chat tables on purpose: an
 * assistant conversation is about the library, not a story, so it has no character, persona,
 * memories or retention rules, and deleting one never touches anything in the library.
 *
 * `touched_hidden` marks a conversation in which a tool returned a hidden item's text. The PIN is
 * only a privacy screen, but the transcript stores tool results, so without the flag a hidden
 * character's card would stay readable in an assistant chat after the PIN was locked again.
 */
export const ASSISTANT_DDL = `
  CREATE TABLE IF NOT EXISTS assistant_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    touched_hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assistant_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_name TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (conversation_id, seq)
  );

  CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation
    ON assistant_messages(conversation_id, seq);

  CREATE TABLE IF NOT EXISTS assistant_proposals (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES assistant_messages(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_assistant_proposals_conversation
    ON assistant_proposals(conversation_id);
`;
