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

function withService(run: (conversations: ConversationService, characterId: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-mood-'));
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

function start(conversations: ConversationService, characterId: string) {
  const conversation = conversations.createConversation({ characterId, model: 'm', greeting: 'Hello' });
  const user = conversations.appendMessage({ conversationId: conversation.id, role: 'user', content: 'one' });
  const reply = conversations.appendAssistantMessage(conversation.id, 'reply', 'm', {} as never, 10).message;
  return { conversation, user, reply };
}

test('a new conversation has no moods; setting one persists per speaker and clearing removes only that speaker', () => {
  withService((conversations, characterId) => {
    const { conversation } = start(conversations, characterId);
    assert.deepEqual(conversation.moods, {});

    conversations.setMood(conversation.id, characterId, ' wary ');
    conversations.setMood(conversation.id, 'guest', 'giddy');
    assert.deepEqual(conversations.getConversation(conversation.id)!.moods, { [characterId]: 'wary', guest: 'giddy' });

    conversations.setMood(conversation.id, characterId, '  ');
    assert.deepEqual(conversations.getConversation(conversation.id)!.moods, { guest: 'giddy' });
  });
});

test('setting a mood is not activity: updated_at is left alone', () => {
  withService((conversations, characterId) => {
    const { conversation } = start(conversations, characterId);
    const before = conversations.getConversation(conversation.id)!.updatedAt;
    conversations.setMood(conversation.id, characterId, 'wary');
    assert.equal(conversations.getConversation(conversation.id)!.updatedAt, before);
  });
});

test('a mood for a missing conversation is refused', () => {
  withService((conversations, characterId) => {
    assert.throws(() => conversations.setMood('nope', characterId, 'wary'), /not found/);
  });
});

test('a whole-chat branch keeps the moods; one cut at an earlier message starts without them', () => {
  withService((conversations, characterId) => {
    const { conversation, user } = start(conversations, characterId);
    conversations.setMood(conversation.id, characterId, 'wary');

    assert.deepEqual(conversations.branchConversation(conversation.id).moods, { [characterId]: 'wary' });
    assert.deepEqual(conversations.branchConversation(conversation.id, user.id).moods, {});
    // The source keeps its own.
    assert.deepEqual(conversations.getConversation(conversation.id)!.moods, { [characterId]: 'wary' });
  });
});
