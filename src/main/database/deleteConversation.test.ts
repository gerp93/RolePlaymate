import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDatabase, closeDatabase } from './schema';
import { SecurityService } from './securityService';
import { PersonaFieldVersionService } from './personaFieldVersionService';
import { CharacterService } from './characterService';
import { ConversationService } from './conversationService';

function withService(
  run: (conversations: ConversationService, characterId: string, db: ReturnType<typeof initDatabase>) => void
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-delete-'));
  try {
    const db = initDatabase(path.join(dir, 'test.db'));
    const security = new SecurityService(db);
    const characterId = new CharacterService(db, security).createCharacter({ name: 'Ada' }).id;
    run(new ConversationService(db, security, new PersonaFieldVersionService(db)), characterId, db);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function count(db: ReturnType<typeof initDatabase>, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
}

test('deleting a conversation removes its messages, variants and memories, and only its own', () => {
  withService((conversations, characterId, db) => {
    const make = () => {
      const c = conversations.createConversation({ characterId, model: 'm', greeting: 'Hello' });
      conversations.appendMessage({ conversationId: c.id, role: 'user', content: 'hi' });
      const reply = conversations.appendAssistantMessage(c.id, 'reply', 'm', {} as never, 10).message;
      conversations.addMemory({ conversationId: c.id, content: 'fact', source: 'auto', messageId: reply.id });
      return c;
    };
    const doomed = make();
    const kept = make();
    const messagesBefore = count(db, 'messages');
    const doomedMessages = conversations.getMessages(doomed.id).length;

    conversations.deleteConversation(doomed.id);

    assert.equal(conversations.getMessages(doomed.id).length, 0);
    assert.equal(count(db, 'messages'), messagesBefore - doomedMessages);
    assert.equal(conversations.listMemories(doomed.id).length, 0);
    assert.equal(conversations.listMemories(kept.id).length, 1);
    assert.equal(conversations.getMessages(kept.id).length, doomedMessages);
  });
});

// The retention freeze: SQLite finds the children of every cascaded row through the child's foreign-key
// column, and with no index that is a scan of the whole table per row. Pin the two that were missing.
test('the foreign keys a conversation delete cascades through are indexed', () => {
  withService((_conversations, _characterId, db) => {
    const plan = (sql: string) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');

    const bySelectedVariant = plan(`SELECT id FROM messages WHERE selected_variant_id = 'x'`);
    assert.match(bySelectedVariant, /USING (COVERING )?INDEX/i, bySelectedVariant);

    const byMessage = plan(`SELECT id FROM conversation_memories WHERE message_id = 'x'`);
    assert.match(byMessage, /USING (COVERING )?INDEX/i, byMessage);
  });
});

test('deleting chats stays fast when the library holds many other messages', () => {
  withService((conversations, characterId, db) => {
    // The cascade cost is rows deleted x rows in the whole table, so the bystander chats are what
    // made retention freeze: one big library, many chats removed in a row.
    const target = conversations.createConversation({ characterId, model: 'm', greeting: 'Hello' });
    const bystander = conversations.createConversation({ characterId, model: 'm', greeting: 'Hello' });
    const insertMessage = db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, seq, created_at) VALUES (?, ?, 'assistant', 'text', ?, ?)`
    );
    const insertVariant = db.prepare(
      `INSERT INTO message_variants (id, message_id, content, created_at) VALUES (?, ?, 'text', ?)`
    );
    const select = db.prepare(`UPDATE messages SET selected_variant_id = ? WHERE id = ?`);
    const insertMemory = db.prepare(
      `INSERT INTO conversation_memories (id, conversation_id, content, source, created_at, message_id) VALUES (?, ?, 'fact', 'auto', ?, ?)`
    );
    const now = new Date().toISOString();
    const seed = (conversationId: string, prefix: string, n: number) => {
      db.exec('BEGIN');
      for (let i = 0; i < n; i++) {
        const messageId = `${prefix}m${i}`;
        const variantId = `${prefix}v${i}`;
        insertMessage.run(messageId, conversationId, 1000 + i, now);
        insertVariant.run(variantId, messageId, now);
        select.run(variantId, messageId);
        insertMemory.run(`${prefix}mem${i}`, conversationId, now, messageId);
      }
      db.exec('COMMIT');
    };
    seed(bystander.id, 'b', 20000);
    seed(target.id, 't', 3000);

    const started = Date.now();
    conversations.deleteConversation(target.id);
    const elapsed = Date.now() - started;

    assert.equal(count(db, 'message_variants'), 20000);
    assert.equal(count(db, 'conversation_memories'), 20000);
    // Unindexed this is a scan of the other 20,000 rows for each of the 3,000 + 3,000 rows removed.
    assert.ok(elapsed < 2000, `delete took ${elapsed} ms`);
  });
});

test('deleteConversationSteps removes the same rows in small steps and reports each step', () => {
  withService((conversations, characterId, db) => {
    const make = () => {
      const c = conversations.createConversation({ characterId, model: 'm', greeting: 'Hello' });
      for (let i = 0; i < 7; i++) {
        conversations.appendMessage({ conversationId: c.id, role: 'user', content: `u${i}` });
        const reply = conversations.appendAssistantMessage(c.id, `r${i}`, 'm', {} as never, 10).message;
        conversations.addMemory({ conversationId: c.id, content: `fact ${i}`, source: 'auto', messageId: reply.id });
      }
      conversations.addMemory({ conversationId: c.id, content: 'pinned', source: 'manual' });
      return c;
    };
    const doomed = make();
    const kept = make();
    const total = conversations.getMessages(doomed.id).length;
    const keptMessages = conversations.getMessages(kept.id).length;

    const steps = [...conversations.deleteConversationSteps(doomed.id, 4)];

    assert.ok(steps.length > 1, 'should take more than one step');
    assert.ok(steps.every((n) => n > 0 && n <= 4));
    assert.equal(steps.reduce((a, b) => a + b, 0), total);
    assert.equal(conversations.getConversation(doomed.id), null);
    assert.equal(conversations.listMemories(doomed.id).length, 0);
    // Only the kept chat's 7 replies still have variants (its greeting has none).
    assert.equal(count(db, 'message_variants'), 7);
    assert.equal(conversations.getMessages(kept.id).length, keptMessages);
    assert.equal(conversations.listMemories(kept.id).length, 8);
  });
});
