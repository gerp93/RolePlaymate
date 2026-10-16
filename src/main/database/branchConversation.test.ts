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

/** A real (temporary) database, because what matters here is which rows the copy leaves behind. */
function withService(run: (conversations: ConversationService, characterId: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-branch-'));
  try {
    const db = initDatabase(path.join(dir, 'test.db'));
    const security = new SecurityService(db);
    const characterId = new CharacterService(db, security).createCharacter({ name: 'Ada' }).id;
    run(new ConversationService(db, security, new PersonaFieldVersionService(db)), characterId);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function seed(conversations: ConversationService, characterId: string) {
  const conversation = conversations.createConversation({ characterId, model: 'm', greeting: 'Hello' });
  const user1 = conversations.appendMessage({ conversationId: conversation.id, role: 'user', content: 'one' });
  const reply1 = conversations.appendAssistantMessage(conversation.id, 'reply one', 'm', {} as never, 10).message;
  const user2 = conversations.appendMessage({ conversationId: conversation.id, role: 'user', content: 'two' });
  const reply2 = conversations.appendAssistantMessage(conversation.id, 'reply two', 'm', {} as never, 10).message;
  conversations.addMemory({ conversationId: conversation.id, content: 'early fact', source: 'auto', messageId: reply1.id });
  conversations.addMemory({ conversationId: conversation.id, content: 'late fact', source: 'auto', messageId: reply2.id });
  conversations.addMemory({ conversationId: conversation.id, content: 'pinned fact', source: 'manual' });
  return { conversation, user1, reply1, user2, reply2 };
}

test('branching at a message copies nothing after it, nor memories from what was left behind', () => {
  withService((conversations, characterId) => {
    const { conversation, reply1 } = seed(conversations, characterId);
    const branch = conversations.branchConversation(conversation.id, reply1.id);

    assert.deepEqual(
      conversations.getMessages(branch.id).map((m) => m.content),
      ['Hello', 'one', 'reply one']
    );
    assert.deepEqual(
      conversations.listMemories(branch.id).map((m) => m.content).sort(),
      ['early fact', 'pinned fact']
    );
    // The source is untouched.
    assert.equal(conversations.getMessages(conversation.id).length, 5);
    assert.equal(conversations.listMemories(conversation.id).length, 3);
  });
});

test('branching without a message copies the whole conversation', () => {
  withService((conversations, characterId) => {
    const { conversation } = seed(conversations, characterId);
    const branch = conversations.branchConversation(conversation.id);
    assert.equal(conversations.getMessages(branch.id).length, 5);
    assert.equal(conversations.listMemories(branch.id).length, 3);
  });
});

test('a message from another conversation is refused', () => {
  withService((conversations, characterId) => {
    const a = seed(conversations, characterId);
    const b = seed(conversations, characterId);
    assert.throws(() => conversations.branchConversation(a.conversation.id, b.reply1.id), /not in conversation/);
  });
});
