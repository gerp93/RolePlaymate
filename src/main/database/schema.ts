import { openDatabase, type DatabaseSync } from './sqlite';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getEffectiveDbPath } from '../dbLocation';
import { CHAT_DDL } from './chatSchema';
import { LOREBOOK_DDL } from './lorebookSchema';
import { hashPin } from './securityService';
import { DEFAULT_TEMPLATES } from '../chat/promptTemplates';
import { TEMPLATE_FIELD_KEYS } from '../../shared/types/promptTemplates';

let dbInstance: DatabaseSync | null = null;

/** `password` unlocks an encrypted database; omit it for a plain one. A wrong or missing
 * password on an encrypted file throws (see `openDatabase`). */
export function initDatabase(dbPath?: string, password?: string): DatabaseSync {
  dbPath = dbPath ?? getEffectiveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // Foreign keys are enforced (openDatabase turns the pragma on), so the ON DELETE CASCADE
  // declarations below do real work and services don't hand-roll cascade cleanup.
  const db = openDatabase(dbPath, password);

  // WAL keeps writes incremental instead of rewriting the whole file. It creates `-wal` and
  // `-shm` sidecars next to the database; a clean close() checkpoints and removes them,
  // which is why relocating the database must close it first (see dbLocation.setDbPath).
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  dbInstance = db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- "fields" are content records (versioned personality/scenario/greeting text) -- every
    -- character gets exactly one of each field_type, created alongside the character itself.
    CREATE TABLE IF NOT EXISTS character_fields (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      field_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      UNIQUE (character_id, field_type)
    );

    CREATE TABLE IF NOT EXISTS character_field_versions (
      id TEXT PRIMARY KEY,
      field_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (field_id) REFERENCES character_fields(id) ON DELETE CASCADE,
      UNIQUE (field_id, version_number)
    );

    -- Enforces "one active version per field" at the DB level, not just in service code.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_field
      ON character_field_versions(field_id) WHERE is_active = 1;

    CREATE INDEX IF NOT EXISTS idx_fields_character ON character_fields(character_id);
    CREATE INDEX IF NOT EXISTS idx_field_versions_field ON character_field_versions(field_id);

    -- A character can have zero or more portrait images, ordered by position (0 = cover,
    -- shown on the character list tile). Replaces the old single \`characters.image_url\` column,
    -- which is left in place (unused going forward) purely so migrateLegacyPortraits below can
    -- still read pre-existing single portraits on upgrade.
    CREATE TABLE IF NOT EXISTS character_images (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      path TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_character_images_character ON character_images(character_id);

    -- A group is a deliberate ensemble of 2+ characters that chat together -- a peer of
    -- \`characters\` (own name, own hide flag, own scenarios). \`instructions\` is plain text
    -- injected into every member's prompt. Named character_groups rather than \`groups\` because
    -- GROUPS is a window-frame keyword in newer SQLite.
    CREATE TABLE IF NOT EXISTS character_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- The roster, many-to-many. Deleting a character just drops it from every roster; deleting a
    -- group leaves its characters alone. \`position\` is the display/greeting order.
    CREATE TABLE IF NOT EXISTS character_group_members (
      group_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (group_id, character_id),
      FOREIGN KEY (group_id) REFERENCES character_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_group_members_character ON character_group_members(character_id);

    -- A list of settings/situations owned by EITHER one character or one group (exactly one --
    -- see the CHECK), each independently versioned and hideable -- see scenarioService.ts. Split
    -- out from character_fields (where "scenario" used to be a fixed single slot) so a
    -- character's permanent traits (personality/dialogue) don't have to be duplicated onto a
    -- whole new character just to reuse them somewhere else. A group-owned scenario is the
    -- shared setting for that ensemble. Databases created before groups existed have
    -- character_id NOT NULL and no group_id; migrateScenariosToNullableOwner rebuilds them.
    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      character_id TEXT,
      group_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES character_groups(id) ON DELETE CASCADE,
      CHECK ((character_id IS NULL) <> (group_id IS NULL))
    );

    -- Mirrors character_field_versions exactly (self-healing "active always tracks latest").
    CREATE TABLE IF NOT EXISTS scenario_versions (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      UNIQUE (scenario_id, version_number)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_scenario
      ON scenario_versions(scenario_id) WHERE is_active = 1;
    CREATE INDEX IF NOT EXISTS idx_scenario_versions_scenario ON scenario_versions(scenario_id);

    -- A scenario's own opening greeting -- same shape and versioning rules as
    -- scenario_versions, just a second independent text per scenario rather than reusing that
    -- table with a discriminator column. Greeting used to be a fixed CharacterField like
    -- scenario was; it's scenario-specific for the same reason scenario itself is (what a
    -- character opens with legitimately differs by situation). No scenario selected means no
    -- greeting, same as no scenario means no [SCENARIO] section.
    CREATE TABLE IF NOT EXISTS scenario_greeting_versions (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
      UNIQUE (scenario_id, version_number)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_scenario_greeting
      ON scenario_greeting_versions(scenario_id) WHERE is_active = 1;
    CREATE INDEX IF NOT EXISTS idx_scenario_greeting_versions_scenario
      ON scenario_greeting_versions(scenario_id);

    -- Mirrors character_images exactly -- a scenario's own gallery, joined into that chat's
    -- image picker only while the scenario is selected (see Chat.tsx).
    CREATE TABLE IF NOT EXISTS scenario_images (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      path TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scenario_images_scenario ON scenario_images(scenario_id);

    -- Per-(image, display location) pan/zoom -- the same portrait can need a different crop as
    -- a small circular chat avatar than as a tall detail-page portrait, so this is keyed on
    -- both rather than storing one crop per image. \`image_id\` points into character_images,
    -- persona_images, or scenario_images depending on \`image_owner\`; there's no single table to
    -- declare a FOREIGN KEY against (no polymorphic FKs in SQLite), so cascade cleanup when an
    -- image or its owning character/persona/scenario is deleted is handled explicitly by the
    -- callers in main.ts rather than ON DELETE CASCADE. A missing row means "default" (zoom 1,
    -- centered), which renders identically to today's plain \`object-fit: cover\` -- see
    -- ImageCropService.
    CREATE TABLE IF NOT EXISTS image_crops (
      id TEXT PRIMARY KEY,
      image_id TEXT NOT NULL,
      image_owner TEXT NOT NULL,
      location TEXT NOT NULL,
      zoom REAL NOT NULL DEFAULT 1,
      offset_x REAL NOT NULL DEFAULT 50,
      offset_y REAL NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (image_id, location)
    );

    CREATE INDEX IF NOT EXISTS idx_image_crops_image ON image_crops(image_id);

    -- One row (id = 1): the salted hash of the Hidden Items PIN -- a privacy screen only, see
    -- securityService.ts. key_salt is a leftover from the old per-row hidden-content
    -- encryption: unused for new rows, and read only by legacyHiddenDecrypt.ts to upgrade
    -- databases that still hold that ciphertext.
    CREATE TABLE IF NOT EXISTS app_security (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pin_hash BLOB NOT NULL,
      pin_salt BLOB NOT NULL,
      key_salt BLOB
    );

    -- Present only while whole-app encryption is on (or was interrupted mid-way): the random
    -- key that encrypts the portrait/audio files beside the database. It lives here so the
    -- database's own encryption protects it, and so changing the password never has to
    -- re-encrypt those files -- see appEncryption.ts.
    CREATE TABLE IF NOT EXISTS app_secrets (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      file_key BLOB NOT NULL
    );

    -- One row (id = 1), one nullable column per stop-phrase setting -- see
    -- promptSettingsService.ts. NULL means "use the built-in default from promptTemplates.ts".
    -- The 7 system-prompt templates themselves used to live here as nullable TEXT columns too,
    -- but now get full version history like character fields -- see prompt_fields/
    -- prompt_field_versions below.
    CREATE TABLE IF NOT EXISTS prompt_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      stop_phrases_base TEXT,
      use_character_name_as_stop INTEGER,
      use_persona_name_as_stop INTEGER
    );

    -- The 7 PromptTemplates keys, as a fixed set of always-existing rows (like a character's
    -- personality/scenario/greeting fields) -- see promptFieldVersionService.ts.
    CREATE TABLE IF NOT EXISTS prompt_fields (
      id TEXT PRIMARY KEY,
      field_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_field_versions (
      id TEXT PRIMARY KEY,
      field_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (field_id) REFERENCES prompt_fields(id) ON DELETE CASCADE,
      UNIQUE (field_id, version_number)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_prompt_field
      ON prompt_field_versions(field_id) WHERE is_active = 1;
    CREATE INDEX IF NOT EXISTS idx_prompt_field_versions_field ON prompt_field_versions(field_id);

    -- One row per Ollama model tag with any customized sampler default -- see
    -- modelSamplerService.ts and the Model Tuning settings page. Every column but the key is
    -- nullable: a model with no row, or a row with some columns left null, falls back to
    -- DEFAULT_SAMPLERS (chatSession.ts) for whatever isn't set, same merge convention a
    -- chat-level override already uses over the global default. A model tag is the natural
    -- key -- there's exactly one tuning row per model, not a history to version.
    CREATE TABLE IF NOT EXISTS model_sampler_defaults (
      model TEXT PRIMARY KEY,
      temperature REAL,
      max_tokens INTEGER,
      top_p REAL,
      top_k INTEGER,
      repetition_penalty REAL,
      -- Whether this model is offered in Chat's model dropdown. Ollama lists everything
      -- installed regardless of why (other apps, testing, a size that's not actually wanted
      -- here) -- this lets the Model Tuning page exclude the irrelevant ones without touching
      -- what's actually installed. Defaults on: a model with no row at all is enabled, same
      -- convention every other field on this table already uses.
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(CHAT_DDL);
  db.exec(LOREBOOK_DDL);

  ensureColumn(db, 'characters', 'description', 'TEXT');
  ensureColumn(db, 'characters', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'characters', 'tts_voice_mode', 'TEXT');
  ensureColumn(db, 'characters', 'tts_voice_id', 'TEXT');
  ensureColumn(db, 'user_personas', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'user_personas', 'tts_voice_mode', 'TEXT');
  ensureColumn(db, 'user_personas', 'tts_voice_id', 'TEXT');
  ensureColumn(db, 'lorebooks', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'messages', 'selected_variant_id', 'TEXT REFERENCES message_variants(id) ON DELETE SET NULL');
  ensureColumn(db, 'messages', 'model', 'TEXT');
  ensureColumn(db, 'messages', 'generation_ms', 'INTEGER');
  ensureColumn(db, 'messages', 'tts_audio_path', 'TEXT');
  ensureColumn(db, 'messages', 'directions', 'TEXT');
  ensureColumn(db, 'message_variants', 'model', 'TEXT');
  ensureColumn(db, 'message_variants', 'generation_ms', 'INTEGER');
  ensureColumn(db, 'message_variants', 'tts_audio_path', 'TEXT');
  ensureColumn(db, 'message_variants', 'debug', 'TEXT');
  ensureColumn(db, 'message_variants', 'starred', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'model_sampler_defaults', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'conversation_memories', 'message_id', 'TEXT REFERENCES messages(id) ON DELETE CASCADE');
  ensureColumn(db, 'lorebooks', 'owner_persona_id', 'TEXT REFERENCES user_personas(id) ON DELETE CASCADE');
  ensureColumn(db, 'lorebooks', 'image', 'TEXT');
  ensureColumn(db, 'app_security', 'key_salt', 'BLOB');
  // Durable usage counters -- incremented at write time (conversationService.appendMessage,
  // chatSession's lore-scan call sites) rather than derived from COUNT(*), so deleting the
  // messages/conversations/matches that earned them never erases the tally. Mirrors
  // generation_stats' "holds no reference to what produced it" convention above.
  ensureColumn(db, 'characters', 'message_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'user_personas', 'message_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'lorebook_entries', 'hit_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'conversations', 'character_image_mode', `TEXT NOT NULL DEFAULT 'carousel'`);
  ensureColumn(db, 'conversations', 'character_image_id', 'TEXT REFERENCES character_images(id) ON DELETE SET NULL');
  ensureColumn(db, 'conversations', 'persona_image_mode', `TEXT NOT NULL DEFAULT 'carousel'`);
  ensureColumn(db, 'conversations', 'persona_image_id', 'TEXT REFERENCES persona_images(id) ON DELETE SET NULL');
  ensureColumn(db, 'conversations', 'scenario_id', 'TEXT REFERENCES scenarios(id) ON DELETE SET NULL');
  ensureColumn(db, 'conversations', 'scenario_image_id', 'TEXT REFERENCES scenario_images(id) ON DELETE SET NULL');
  ensureColumn(db, 'conversations', 'keep_forever', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'scenarios', 'description', 'TEXT');
  // Group chat: a conversation is either one character's (character_id) or a group's (group_id),
  // never both. Each assistant message records who spoke it; speaker_name is a snapshot so a
  // line keeps its label after that character is deleted (speaker_character_id then goes NULL).
  ensureColumn(db, 'conversations', 'group_id', 'TEXT REFERENCES character_groups(id) ON DELETE SET NULL');
  ensureColumn(db, 'messages', 'speaker_character_id', 'TEXT REFERENCES characters(id) ON DELETE SET NULL');
  ensureColumn(db, 'messages', 'speaker_name', 'TEXT');
  migrateScenariosToNullableOwner(db);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_group ON conversations(group_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_speaker ON messages(speaker_character_id)`);
  // The non-static mode was originally called 'random' (reroll per message); it's since become
  // 'carousel' (auto-cycle every 10s in the margin portraits). ensureColumn only sets the
  // DEFAULT for brand-new databases, so existing rows written under the old default need a
  // one-time rename to the new value they now mean.
  db.exec(`UPDATE conversations SET character_image_mode = 'carousel' WHERE character_image_mode = 'random'`);
  db.exec(`UPDATE conversations SET persona_image_mode = 'carousel' WHERE persona_image_mode = 'random'`);
  // See the note in lorebookSchema.ts: this index has to wait until the column above is
  // guaranteed to exist, which for an upgraded database is only true after this line runs.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lorebooks_owner_persona ON lorebooks(owner_persona_id)`);
  migrateLegacyPortraits(db);
  migrateLegacyPersonaAvatars(db);
  migratePersonaBackgroundToVersions(db);
  migrateCharacterScenarioFieldToScenarios(db);
  migrateCharacterGreetingFieldToScenarios(db);
  seedDefaultPin(db);
  seedPromptFields(db);

  console.log('Database initialized at:', dbPath);

  return db;
}

/** One-time upgrade path, generic form: adds `column` to `table` if a database created before
 * it existed doesn't have it yet. `columnDdl` is everything after the column name (type and
 * any constraints). */
function ensureColumn(db: DatabaseSync, table: string, column: string, columnDdl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const hasColumn = columns.some((c) => c.name === column);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDdl}`);
  }
}

/**
 * One-time upgrade path: scenarios used to be owned by exactly one character
 * (`character_id NOT NULL`, no `group_id`). Group-owned scenarios need the owner to be either a
 * character or a group, and SQLite can't relax NOT NULL in place, so the table is rebuilt.
 *
 * The dangerous part: with foreign keys on, `DROP TABLE scenarios` would cascade-delete every
 * scenario version, greeting and image and null out `conversations.scenario_id`. Foreign keys
 * therefore have to be OFF for the rebuild -- and that pragma is a no-op inside a transaction,
 * so it is toggled around `transaction()`, not inside it. Child tables refer to `scenarios` by
 * name, so they pick the rebuilt table up without being touched.
 *
 * Idempotent: does nothing once `character_id` is nullable and `group_id` exists. Fails loudly
 * (and rolls back) if the rebuild leaves any dangling reference to `scenarios`, rather than let
 * the app start on a half-migrated library.
 */
function migrateScenariosToNullableOwner(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info(scenarios)`).all();
  const owner = columns.find((c) => c.name === 'character_id');
  const hasGroupColumn = columns.some((c) => c.name === 'group_id');
  const ownerAlreadyNullable = owner ? !owner.notnull : false;

  if (!ownerAlreadyNullable || !hasGroupColumn) {
    const before = (db.prepare(`SELECT COUNT(*) as n FROM scenarios`).get() as { n: number }).n;

    db.pragma('foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(`
          CREATE TABLE scenarios_new (
            id TEXT PRIMARY KEY,
            character_id TEXT,
            group_id TEXT,
            name TEXT NOT NULL,
            description TEXT,
            is_hidden INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES character_groups(id) ON DELETE CASCADE,
            CHECK ((character_id IS NULL) <> (group_id IS NULL))
          );
          INSERT INTO scenarios_new (id, character_id, group_id, name, description, is_hidden, created_at, updated_at)
            SELECT id, character_id, NULL, name, description, is_hidden, created_at, updated_at FROM scenarios;
          DROP TABLE scenarios;
          ALTER TABLE scenarios_new RENAME TO scenarios;
        `);

        const after = (db.prepare(`SELECT COUNT(*) as n FROM scenarios`).get() as { n: number }).n;
        if (after !== before) {
          throw new Error(`Scenario migration lost rows (${before} before, ${after} after)`);
        }
        const dangling = db.prepare(`PRAGMA foreign_key_check`).all().filter((v) => v.parent === 'scenarios');
        if (dangling.length > 0) {
          throw new Error(`Scenario migration left ${dangling.length} dangling reference(s) to scenarios`);
        }
      });
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_scenarios_character ON scenarios(character_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scenarios_group ON scenarios(group_id)`);
}

/** One-time upgrade path: characters created before multi-image support had a single
 * `image_url` column. Adopt that value as each such character's first character_images row
 * (skipping any character that already has images, so this is safe to run on every startup). */
function migrateLegacyPortraits(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, image_url as imageUrl, created_at as createdAt FROM characters
       WHERE image_url IS NOT NULL AND image_url != ''
         AND id NOT IN (SELECT DISTINCT character_id FROM character_images)`
    )
    .all() as unknown as { id: string; imageUrl: string; createdAt: string }[];

  const insert = db.prepare(
    `INSERT INTO character_images (id, character_id, path, position, created_at) VALUES (?, ?, ?, 0, ?)`
  );
  for (const row of rows) {
    insert.run(uuidv4(), row.id, row.imageUrl, row.createdAt);
  }
}

/** One-time upgrade path: personas created before the gallery existed had a single `avatar`
 * column. Adopt that value as each such persona's first persona_images row (skipping any
 * persona that already has images), mirroring migrateLegacyPortraits above. */
function migrateLegacyPersonaAvatars(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, avatar, created_at as createdAt FROM user_personas
       WHERE avatar IS NOT NULL AND avatar != ''
         AND id NOT IN (SELECT DISTINCT persona_id FROM persona_images)`
    )
    .all() as unknown as { id: string; avatar: string; createdAt: string }[];

  const insert = db.prepare(
    `INSERT INTO persona_images (id, persona_id, path, position, created_at) VALUES (?, ?, ?, 0, ?)`
  );
  for (const row of rows) {
    insert.run(uuidv4(), row.id, row.avatar, row.createdAt);
  }
}

/** One-time upgrade path: personas created before background versioning existed have their
 * history in a single `background` column. Adopt that value verbatim as each such persona's
 * v1, active (skipping any persona that already has background versions) -- verbatim because
 * the column is already correctly encrypted-if-hidden, so this is a straight copy, not a
 * decrypt/re-encrypt. Real user data becoming history, unlike seedPromptFields' fresh-default
 * seed -- nothing here is lost. Going forward `user_personas.background` is left unwritten,
 * same convention as `avatar` above; conversationService reads the active version instead. */
function migratePersonaBackgroundToVersions(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, background, created_at as createdAt FROM user_personas
       WHERE id NOT IN (SELECT DISTINCT persona_id FROM persona_background_versions)`
    )
    .all() as unknown as { id: string; background: string | null; createdAt: string }[];

  const insert = db.prepare(
    `INSERT INTO persona_background_versions (id, persona_id, version_number, content, is_active, created_at, updated_at)
     VALUES (?, ?, 1, ?, 1, ?, ?)`
  );
  for (const row of rows) {
    insert.run(uuidv4(), row.id, row.background ?? '', row.createdAt, row.createdAt);
  }
}

/** One-time upgrade path: characters created before Scenario became its own 1-to-N entity had
 * their scenario text in a fixed, single-slot `character_fields` row (field_type = 'scenario').
 * Adopt that text as each such character's first Scenario, named "Default" (skipping any
 * character that already has a scenarios row, so this is safe to run on every startup), and
 * carry over the character's *current* is_hidden as the scenario's starting hidden state so
 * nothing becomes more or less visible than it already was. The old character_fields/
 * character_field_versions rows are left in place, unused -- same convention as the legacy
 * `characters.image_url` column above; scenario is no longer in FIELD_TYPES so nothing reads
 * them going forward, and there's no need to risk a destructive delete during migration. */
function migrateCharacterScenarioFieldToScenarios(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT c.id as characterId, c.is_hidden as isHidden, v.content as content, c.created_at as createdAt
       FROM characters c
       JOIN character_fields f ON f.character_id = c.id AND f.field_type = 'scenario'
       JOIN character_field_versions v ON v.field_id = f.id AND v.is_active = 1
       WHERE v.content IS NOT NULL AND trim(v.content) != ''
         AND c.id NOT IN (SELECT DISTINCT character_id FROM scenarios)`
    )
    .all() as unknown as { characterId: string; isHidden: number; content: string; createdAt: string }[];

  const insertScenario = db.prepare(
    `INSERT INTO scenarios (id, character_id, name, is_hidden, created_at, updated_at)
     VALUES (?, ?, 'Default', ?, ?, ?)`
  );
  const insertVersion = db.prepare(
    `INSERT INTO scenario_versions (id, scenario_id, version_number, content, is_active, created_at, updated_at)
     VALUES (?, ?, 1, ?, 1, ?, ?)`
  );

  for (const row of rows) {
    const scenarioId = uuidv4();
    insertScenario.run(scenarioId, row.characterId, row.isHidden, row.createdAt, row.createdAt);
    insertVersion.run(uuidv4(), scenarioId, row.content, row.createdAt, row.createdAt);
  }
}

/** One-time upgrade path: greeting used to be a fixed CharacterField too; it's now
 * scenario-specific, the same as scenario text (see scenario_greeting_versions). Must run
 * after migrateCharacterScenarioFieldToScenarios: a character with both old scenario and
 * greeting text gets both folded into the *same* migrated "Default" scenario rather than two
 * separate ones -- this reuses that character's first existing scenario if it has one, only
 * creating a fresh "Default" when it doesn't (a character with greeting but no scenario text).
 * Gated on "no scenario of this character has a greeting version yet" rather than "character
 * has zero scenarios" (unlike the migration above), so it stays idempotent even though it may
 * be attaching to an already-existing scenario rather than one it creates itself. */
function migrateCharacterGreetingFieldToScenarios(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT c.id as characterId, c.is_hidden as isHidden, v.content as content, c.created_at as createdAt
       FROM characters c
       JOIN character_fields f ON f.character_id = c.id AND f.field_type = 'greeting'
       JOIN character_field_versions v ON v.field_id = f.id AND v.is_active = 1
       WHERE v.content IS NOT NULL AND trim(v.content) != ''
         AND c.id NOT IN (
           SELECT s.character_id FROM scenarios s
           JOIN scenario_greeting_versions gv ON gv.scenario_id = s.id
         )`
    )
    .all() as unknown as { characterId: string; isHidden: number; content: string; createdAt: string }[];

  const insertScenario = db.prepare(
    `INSERT INTO scenarios (id, character_id, name, is_hidden, created_at, updated_at)
     VALUES (?, ?, 'Default', ?, ?, ?)`
  );
  const insertGreeting = db.prepare(
    `INSERT INTO scenario_greeting_versions (id, scenario_id, version_number, content, is_active, created_at, updated_at)
     VALUES (?, ?, 1, ?, 1, ?, ?)`
  );
  const findExistingScenario = db.prepare(
    `SELECT id FROM scenarios WHERE character_id = ? ORDER BY created_at LIMIT 1`
  );

  for (const row of rows) {
    const existing = findExistingScenario.get(row.characterId) as { id: string } | undefined;
    const scenarioId = existing?.id ?? uuidv4();
    if (!existing) {
      insertScenario.run(scenarioId, row.characterId, row.isHidden, row.createdAt, row.createdAt);
    }
    insertGreeting.run(uuidv4(), scenarioId, row.content, row.createdAt, row.createdAt);
  }
}

/** One-time seed: a fresh database (or one from before this feature existed) gets the
 * default PIN "1234" so the Hidden Items lock works out of the box. It's only a privacy screen,
 * so a well-known default is fine until the user changes it in Settings. Safe to call on every
 * startup -- it's a no-op once the row exists. `key_salt` stays NULL: it only ever mattered to
 * the old per-row encryption, and legacyHiddenDecrypt.ts reads it from pre-existing rows. */
function seedDefaultPin(db: DatabaseSync): void {
  const row = db.prepare(`SELECT id FROM app_security WHERE id = 1`).get();
  if (row) return;

  const { hash, salt } = hashPin('1234');
  db.prepare(`INSERT INTO app_security (id, pin_hash, pin_salt) VALUES (1, ?, ?)`).run(hash, salt);
}

/** One-time seed (idempotent, safe on every startup): each of the 7 PromptTemplates keys gets
 * a `prompt_fields` row if missing, and if that field has zero versions yet, a version 1
 * containing the built-in default text, active. Version 1 is then permanently "what the
 * original default was" -- a later "Reset to Default" always inserts a *new* version rather
 * than touching v1, so it stays a stable reference point even after DEFAULT_TEMPLATES changes
 * in a future release. */
function seedPromptFields(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insertField = db.prepare(
    `INSERT OR IGNORE INTO prompt_fields (id, field_key, created_at, updated_at) VALUES (?, ?, ?, ?)`
  );
  const getField = db.prepare(`SELECT id FROM prompt_fields WHERE field_key = ?`);
  const countVersions = db.prepare(`SELECT COUNT(*) as n FROM prompt_field_versions WHERE field_id = ?`);
  const insertVersion = db.prepare(
    `INSERT INTO prompt_field_versions (id, field_id, version_number, content, is_active, created_at, updated_at)
     VALUES (?, ?, 1, ?, 1, ?, ?)`
  );

  for (const fieldKey of TEMPLATE_FIELD_KEYS) {
    insertField.run(uuidv4(), fieldKey, now, now);
    const field = getField.get(fieldKey) as { id: string };
    const { n } = countVersions.get(field.id) as { n: number };
    if (n === 0) {
      insertVersion.run(uuidv4(), field.id, DEFAULT_TEMPLATES[fieldKey], now, now);
    }
  }
}

/** Run `fn` inside a transaction, so multi-statement writes can't leave half-applied state.
 * Re-entrant: a nested call joins the transaction already in progress rather than issuing a
 * second BEGIN (which SQLite rejects) -- needed because some writes call into read helpers
 * that write themselves, e.g. duplicateVersion -> getVersionsByField -> ensureLatestIsActive. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.inTransaction) {
    return fn();
  }

  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getDatabase(): DatabaseSync | null {
  return dbInstance;
}

/** Closes the database, checkpointing the WAL and removing its `-wal`/`-shm` sidecars.
 * Idempotent -- safe to call from both `before-quit` and the database-relocation handlers. */
export function closeDatabase(): void {
  if (dbInstance?.open) {
    dbInstance.close();
  }
  dbInstance = null;
}
