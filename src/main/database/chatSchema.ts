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

  -- A persona can have zero or more portrait images, ordered by position (0 = cover, shown on
  -- the persona list tile) -- mirrors character_images exactly. Replaces the old single
  -- \`user_personas.avatar\` column, left in place (unused going forward) purely so
  -- migrateLegacyPersonaAvatars in schema.ts can still read pre-existing single avatars on
  -- upgrade, same convention as characters.image_url.
  CREATE TABLE IF NOT EXISTS persona_images (
    id TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL,
    path TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (persona_id) REFERENCES user_personas(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_persona_images_persona ON persona_images(persona_id);

  -- Version history for a persona's background, same idea as character_field_versions but
  -- keyed directly by persona rather than through a fields-table indirection -- a persona has
  -- exactly one versionable field, not several field *types* per owner, so there's nothing for
  -- an intermediate table to distinguish. See personaFieldVersionService.ts. The old
  -- \`user_personas.background\` column is left in place (unused going forward) purely so
  -- schema.ts's one-time backfill can still adopt pre-existing background text as v1 on
  -- upgrade, same convention as \`avatar\`/\`image_url\` above.
  CREATE TABLE IF NOT EXISTS persona_background_versions (
    id TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL REFERENCES user_personas(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (persona_id, version_number)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_persona_background
    ON persona_background_versions(persona_id) WHERE is_active = 1;
  CREATE INDEX IF NOT EXISTS idx_persona_background_versions_persona
    ON persona_background_versions(persona_id);

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
    user_persona_id TEXT REFERENCES user_personas(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    -- Retention never deletes a kept conversation, regardless of age or message count.
    keep_forever INTEGER NOT NULL DEFAULT 0
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
    model TEXT,
    -- Absolute path of a saved spoken WAV beside the database. User messages store it here;
    -- assistant messages mirror the selected variant's path, same convention as content/model.
    tts_audio_path TEXT
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
    -- Saved spoken WAV for this variant. Switching variants never reuses another variant's
    -- clip -- a redo is different text, so it gets its own file or none.
    tts_audio_path TEXT,
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
