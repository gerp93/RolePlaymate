import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDatabase, closeDatabase } from '../database/schema';
import { SecurityService } from '../database/securityService';
import { CharacterService } from '../database/characterService';
import { CharacterFieldService } from '../database/characterFieldService';
import { FieldVersionService } from '../database/fieldVersionService';
import { ConversationService } from '../database/conversationService';
import { PersonaFieldVersionService } from '../database/personaFieldVersionService';
import { ScenarioService } from '../database/scenarioService';
import { GroupService } from '../database/groupService';
import { LorebookService } from '../database/lorebookService';
import { AssistantService } from '../database/assistantService';
import { OllamaClient } from './ollamaClient';
import { LibraryServices, Library, loadLibrary } from './assistantLibrary';
import { ASSISTANT_TOOLS, executeTool } from './assistantTools';
import { applyCreate, applyNewVersion, ProposalError } from './assistantApply';
import { AssistantManager, buildRequestMessages } from './assistantSession';
import { buildAssistantSystemPrompt, renderLibraryIndex } from './assistantPrompt';
import { clip, resolveOne, similarity } from './assistantText';
import type {
  AssistantMessage,
  AssistantSettings,
  AssistantStreamEvent,
  CreatePayload,
  NewVersionPayload,
} from '../../shared/types/assistant';

// --- pure helpers ----------------------------------------------------------------------------

test('similarity finds near-copies and ignores unrelated cards', () => {
  const a = 'A smuggler captain who runs contraband through the harbour at night and distrusts the dock authority.';
  const copy = 'A smuggler captain who runs contraband through the harbour by night, distrusting the dock authority.';
  const other = 'A gentle botanist tending orchids in a glass observatory above the clouds.';
  assert.ok(similarity(a, copy) > 0.5, `copy scored ${similarity(a, copy)}`);
  assert.ok(similarity(a, other) < 0.1, `unrelated scored ${similarity(a, other)}`);
  assert.equal(similarity('', a), 0);
});

test('resolveOne prefers exact, accepts a unique partial, and lists ids when ambiguous', () => {
  const items = [
    { id: 'id-1', name: 'Ada Vance' },
    { id: 'id-2', name: 'Ada Reyes' },
    { id: 'id-3', name: 'Bram' },
  ];
  const find = (q: string) => resolveOne(items, q, (i) => i.name, (i) => i.id, 'character');
  assert.deepEqual(find('bram'), { item: items[2] });
  assert.deepEqual(find('Reyes'), { item: items[1] });
  assert.deepEqual(find('id-1'), { item: items[0] });
  const ambiguous = find('Ada');
  assert.ok('error' in ambiguous && ambiguous.error.includes('id-1') && ambiguous.error.includes('id-2'));
  const missing = find('Zed');
  assert.ok('error' in missing && missing.error.includes('list_library'));
});

test('clip says how much it cut', () => {
  assert.equal(clip('short', 100), 'short');
  assert.match(clip('word '.repeat(100), 50), /more characters not shown\]$/);
});

// --- tools over a hand-built library ---------------------------------------------------------

function library(): Library {
  return {
    characters: [
      { id: 'c1', name: 'Ada Vance', description: 'Harbour smuggler', personality: 'A smuggler captain who runs contraband through the harbour at night and distrusts the dock authority.', dialogue: '{{char}}: "Keep your voice down."', hidden: false, isQuick: false, worldBooks: ['Saltmarsh'] },
      { id: 'c2', name: 'Ada Vance', description: 'Harbour smuggler', personality: 'A smuggler captain who runs contraband through the harbour by night, distrusting the dock authority.', dialogue: '', hidden: false, isQuick: false, worldBooks: [] },
      { id: 'c3', name: 'Mira', description: 'Botanist', personality: 'A gentle botanist tending orchids in a glass observatory above the clouds.', dialogue: '', hidden: false, isQuick: false, worldBooks: [] },
      { id: 'c4', name: 'Secret', description: 'Hidden one', personality: 'Private material.', dialogue: '', hidden: true, isQuick: false, worldBooks: [] },
    ],
    personas: [{ id: 'p1', name: 'Alex', description: 'Salvager', background: 'Grew up on a mining colony.', hidden: false }],
    scenarios: [
      { id: 's1', name: 'Night run', description: 'A cargo run', content: 'Fog on the harbour.', greeting: '"You are late."', ownerKind: 'character', ownerId: 'c1', ownerName: 'Ada Vance', hidden: false },
    ],
    groups: [],
    books: [{ id: 'b1', name: 'Saltmarsh', description: 'The port', scope: 'world', ownerName: null, hidden: false, entries: [{ id: 'e1', title: 'Dock authority', keys: 'dock, authority', content: 'Corrupt and underpaid.' }] }],
  };
}

test('every tool the model is offered is dispatched, and an unknown one is an error that names the real tools', () => {
  const lib = library();
  for (const t of ASSISTANT_TOOLS) {
    const outcome = executeTool(t.function.name, {}, lib);
    assert.ok(!outcome.text.includes('There is no tool called'), `${t.function.name} is not dispatched`);
  }
  const unknown = executeTool('delete_everything', {}, lib);
  assert.ok(unknown.isError && unknown.text.includes('list_library'));
});

test('list_library and read_item show active text, and flag hidden content', () => {
  const lib = library();
  const list = executeTool('list_library', { kind: 'characters' }, lib);
  assert.ok(list.text.includes('Mira -- Botanist'));
  assert.equal(list.touchedHidden, true, 'the hidden character is in the list');

  const read = executeTool('read_item', { kind: 'character', name: 'Mira' }, lib);
  assert.ok(read.text.includes('gentle botanist'));
  assert.equal(read.touchedHidden, undefined);

  const hidden = executeTool('read_item', { kind: 'character', name: 'Secret' }, lib);
  assert.equal(hidden.touchedHidden, true);

  const scenario = executeTool('read_item', { kind: 'scenario', name: 'Night run' }, lib);
  assert.ok(scenario.text.includes('Fog on the harbour') && scenario.text.includes('You are late'));
});

test('search_library finds text in cards, scenarios and lorebook entries', () => {
  const lib = library();
  const hits = executeTool('search_library', { query: 'dock authority' }, lib).text;
  assert.ok(hits.includes('lorebook "Saltmarsh" entry "Dock authority"'));
  assert.ok(hits.includes('character "Ada Vance"'));
  assert.ok(executeTool('search_library', { query: 'zeppelin' }, lib).text.includes('Nothing in the library'));
  assert.ok(executeTool('search_library', {}, lib).isError);
});

test('find_similar flags the two Adas and not the botanist', () => {
  const lib = library();
  const all = executeTool('find_similar', { kind: 'characters' }, lib).text;
  assert.ok(all.includes('[same name]'));
  assert.ok(!all.includes('Mira'), all);
  const one = executeTool('find_similar', { name: 'Mira' }, lib).text;
  assert.ok(one.startsWith('No pairs overlap'), one);
  assert.ok(executeTool('find_similar', {}, lib).isError, 'needs a kind or a name');
});

test('propose_new_version records a proposal with the current text as "before", and applies nothing', () => {
  const lib = library();
  const outcome = executeTool(
    'propose_new_version',
    { entity: 'character', name: 'Mira', field: 'personality', content: 'A botanist who hides a sharp temper.', summary: 'Add an edge' },
    lib
  );
  assert.ok(!outcome.isError, outcome.text);
  assert.ok(outcome.text.includes('NOT applied'));
  const payload = outcome.proposal!.payload as NewVersionPayload;
  assert.equal(payload.entityId, 'c3');
  assert.equal(payload.before, 'A gentle botanist tending orchids in a glass observatory above the clouds.');
  assert.equal(payload.after, 'A botanist who hides a sharp temper.');
});

test('propose_new_version rejects a wrong field, an over-long text, an identical text and an ambiguous name', () => {
  const lib = library();
  const wrongField = executeTool('propose_new_version', { entity: 'persona', name: 'Alex', field: 'personality', content: 'x' }, lib);
  assert.ok(wrongField.isError && wrongField.text.includes('background'));
  const tooLong = executeTool('propose_new_version', { entity: 'character', name: 'Mira', field: 'personality', content: 'x'.repeat(5001) }, lib);
  assert.ok(tooLong.isError && tooLong.text.includes('5,000'));
  const same = executeTool('propose_new_version', { entity: 'character', name: 'Mira', field: 'personality', content: lib.characters[2].personality }, lib);
  assert.ok(same.isError && same.text.includes('identical'));
  const ambiguous = executeTool('propose_new_version', { entity: 'character', name: 'Ada Vance', field: 'personality', content: 'y' }, lib);
  assert.ok(ambiguous.isError && ambiguous.text.includes('c1') && ambiguous.text.includes('c2'));
  assert.equal(wrongField.proposal, undefined);
});

test('propose_create validates owner, field names and duplicates', () => {
  const lib = library();
  const ok = executeTool('propose_create', { entity: 'scenario', name: 'Storm watch', owner: 'Mira', content: 'A storm closes in.', greeting: '"Hold the line."' }, lib);
  assert.ok(!ok.isError, ok.text);
  assert.equal((ok.proposal!.payload as CreatePayload).ownerCharacterId, 'c3');

  assert.ok(executeTool('propose_create', { entity: 'scenario', name: 'Orphan' }, lib).text.includes('give owner'));
  assert.ok(executeTool('propose_create', { entity: 'scenario', name: 'X', owner: 'Nobody' }, lib).isError);
  assert.ok(executeTool('propose_create', { entity: 'persona', name: 'Alex' }, lib).text.includes('already exists'));
  assert.ok(executeTool('propose_create', { entity: 'character', name: 'mira' }, lib).text.includes('already exists'));
  assert.ok(executeTool('propose_create', { entity: 'persona', name: 'Zed', personality: 'x' }, lib).text.includes('Remove "personality"'));
});

test('update_notes returns the notes for the manager to store', () => {
  const outcome = executeTool('update_notes', { notes: 'Direction: noir harbour story.' }, library());
  assert.equal(outcome.notes, 'Direction: noir harbour story.');
});

// --- prompt and history ----------------------------------------------------------------------

test('the system prompt states the real limits and the index never names hidden items', () => {
  const prompt = buildAssistantSystemPrompt({ library: library(), styleGuide: 'Second person, present tense.', notes: 'Noir.' });
  assert.ok(prompt.includes('5,000') && prompt.includes('10,000') && prompt.includes('2,000'));
  assert.ok(prompt.includes('Second person, present tense.') && prompt.includes('Noir.'));
  assert.ok(prompt.includes('Mira'));
  assert.ok(!renderLibraryIndex(library()).includes('Secret'));
  assert.equal(renderLibraryIndex({ characters: [], personas: [], scenarios: [], groups: [], books: [] }), 'The library is empty.');
});

function msg(seq: number, role: AssistantMessage['role'], content: string, extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return { id: `m${seq}`, conversationId: 'c', seq, role, content, toolCalls: null, toolName: null, createdAt: '', ...extra };
}

test('history is cut between turns, never inside one, and the newest turn always survives', () => {
  const call = [{ name: 'read_item', arguments: { kind: 'character', name: 'Mira' } }];
  const history = [
    msg(1, 'user', 'old question ' + 'a'.repeat(4000)),
    msg(2, 'assistant', '', { toolCalls: call }),
    msg(3, 'tool', 'b'.repeat(4000), { toolName: 'read_item' }),
    msg(4, 'assistant', 'old answer'),
    msg(5, 'user', 'new question'),
    msg(6, 'assistant', '', { toolCalls: call }),
    msg(7, 'tool', 'c'.repeat(5000), { toolName: 'read_item' }),
  ];
  // Big window: everything fits; the old tool result is shortened, the newest kept whole.
  const roomy = buildRequestMessages('sys', history, 32_000);
  assert.equal(roomy.droppedTurns, 0);
  const tools = roomy.messages.filter((m) => m.role === 'tool');
  assert.ok(tools[0].content.length < 700 && tools[1].content.length === 5000);

  // Tiny window: the old turn goes entirely; no orphaned tool result opens the history.
  const tight = buildRequestMessages('sys', history, 3300);
  assert.equal(tight.droppedTurns, 1);
  assert.equal(tight.messages[1].role, 'user');
  assert.equal(tight.messages.length, 1 + 3);
});

// --- real database ---------------------------------------------------------------------------

function withLibrary(run: (s: LibraryServices, assistant: AssistantService) => void | Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-assistant-'));
  const db = initDatabase(path.join(dir, 'test.db'));
  const security = new SecurityService(db);
  const fieldVersions = new FieldVersionService(db);
  const personaVersions = new PersonaFieldVersionService(db);
  const services: LibraryServices = {
    db,
    security,
    fieldVersions,
    personaVersions,
    characters: new CharacterService(db, security),
    fields: new CharacterFieldService(db),
    conversations: new ConversationService(db, security, personaVersions),
    scenarios: new ScenarioService(db, security),
    groups: new GroupService(db, security),
    lorebooks: new LorebookService(db, security),
  };
  const finish = () => {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = run(services, new AssistantService(db));
    return Promise.resolve(result).finally(finish);
  } catch (error) {
    finish();
    throw error;
  }
}

function newCharacter(s: LibraryServices, name: string, personality = '') {
  applyCreate(s, { entity: 'character', name, description: '', fields: { personality } });
  return s.characters.getAllCharacters().find((c) => c.name === name)!;
}

test('loadLibrary leaves hidden rows out while locked and includes them once unlocked', () =>
  withLibrary((s) => {
    const visible = newCharacter(s, 'Visible');
    const secret = newCharacter(s, 'Secret', 'private card');
    s.security.unlock('1234');
    s.characters.setHidden(secret.id, true);
    s.scenarios.createScenario({ characterId: secret.id }, 'Secret scene');
    s.security.lock();

    const locked = loadLibrary(s);
    assert.deepEqual(locked.characters.map((c) => c.name), ['Visible']);
    assert.equal(locked.scenarios.length, 0, "a hidden character's scenarios are hidden with it");
    assert.ok(!renderLibraryIndex(locked).includes('Secret'));
    assert.ok(executeTool('read_item', { kind: 'character', name: 'Secret' }, locked).isError, 'a locked assistant cannot even confirm it exists');

    s.security.unlock('1234');
    const open = loadLibrary(s);
    assert.deepEqual(open.characters.map((c) => c.name).sort(), ['Secret', 'Visible']);
    assert.equal(open.characters.find((c) => c.name === 'Secret')!.hidden, true);
    assert.equal(visible.name, 'Visible');
  }));

test('applying a new version adds to the history, keeps the old text, and makes the new one active', () =>
  withLibrary((s) => {
    const ada = newCharacter(s, 'Ada', 'Original personality.');
    const payload: NewVersionPayload = { entity: 'character', entityId: ada.id, entityName: 'Ada', field: 'personality', before: 'Original personality.', after: 'Revised personality.' };
    applyNewVersion(s, payload);

    const field = s.fields.getFieldsByCharacter(ada.id).find((f) => f.fieldType === 'personality')!;
    const versions = s.fieldVersions.getVersionsByField(field.id);
    assert.deepEqual(versions.map((v) => [v.versionNumber, v.content, v.isActive]), [[1, 'Original personality.', false], [2, 'Revised personality.', true]]);
    assert.equal(loadLibrary(s).characters[0].personality, 'Revised personality.');

    // Dialogue never had text; its first proposal still lands as the newest, active version.
    applyNewVersion(s, { ...payload, field: 'dialogue', before: '', after: '{{char}}: "Hi."' });
    assert.equal(loadLibrary(s).characters[0].dialogue, '{{char}}: "Hi."');
  }));

test('applying persona and scenario versions, and creating each kind of item', () =>
  withLibrary((s) => {
    applyCreate(s, { entity: 'persona', name: 'Alex', description: 'Salvager', fields: { background: 'v1 background' } });
    const persona = s.conversations.listPersonas()[0];
    applyNewVersion(s, { entity: 'persona', entityId: persona.id, entityName: 'Alex', field: 'background', before: 'v1 background', after: 'v2 background' });
    assert.deepEqual(s.personaVersions.getVersionsByPersona(persona.id).map((v) => [v.content, v.isActive]), [['v1 background', false], ['v2 background', true]]);

    const ada = newCharacter(s, 'Ada');
    applyCreate(s, { entity: 'scenario', name: 'Night run', description: 'A cargo run', fields: { content: 'Fog.', greeting: '"Late."' }, ownerCharacterId: ada.id, ownerName: 'Ada' });
    const scenario = s.scenarios.getScenariosByCharacter(ada.id)[0];
    assert.equal(s.scenarios.getVersions(scenario.id).length, 1, 'fills the seeded blank version instead of stacking a v2');
    assert.equal(s.scenarios.getActiveContent(scenario.id), 'Fog.');
    assert.equal(s.scenarios.getActiveGreeting(scenario.id), '"Late."');

    applyNewVersion(s, { entity: 'scenario', entityId: scenario.id, entityName: 'Night run', field: 'content', before: 'Fog.', after: 'Heavy fog.' });
    applyNewVersion(s, { entity: 'scenario', entityId: scenario.id, entityName: 'Night run', field: 'greeting', before: '"Late."', after: '"You are late."' });
    assert.equal(s.scenarios.getVersions(scenario.id).length, 2);
    assert.equal(s.scenarios.getActiveGreeting(scenario.id), '"You are late."');
  }));

test('a failing proposal leaves nothing behind and explains itself', () =>
  withLibrary((s) => {
    applyCreate(s, { entity: 'persona', name: 'Alex', description: '', fields: {} });
    assert.throws(() => applyCreate(s, { entity: 'persona', name: 'alex', description: '', fields: {} }), ProposalError);
    assert.equal(s.conversations.listPersonas().length, 1);

    assert.throws(
      () => applyCreate(s, { entity: 'scenario', name: 'Lost', description: '', fields: {}, ownerCharacterId: 'gone', ownerName: 'Gone' }),
      /no longer exists/
    );
    assert.throws(
      () => applyNewVersion(s, { entity: 'character', entityId: 'gone', entityName: 'Gone', field: 'personality', before: '', after: 'x' }),
      /no longer exists/
    );

    const ada = newCharacter(s, 'Ada');
    s.security.unlock('1234');
    s.characters.setHidden(ada.id, true);
    s.security.lock();
    assert.throws(
      () => applyNewVersion(s, { entity: 'character', entityId: ada.id, entityName: 'Ada', field: 'personality', before: '', after: 'x' }),
      /hidden/
    );
  }));

test('assistant conversations that touched hidden content disappear while locked; deleting one leaves the library alone', () =>
  withLibrary((s, store) => {
    const calm = store.createConversation('m');
    const touched = store.createConversation('m');
    store.markTouchedHidden(touched.id);
    assert.deepEqual(store.listConversations(false).map((c) => c.id), [calm.id]);
    assert.equal(store.listConversations(true).length, 2);

    newCharacter(s, 'Ada');
    store.deleteConversation(calm.id);
    assert.equal(s.characters.getAllCharacters().length, 1);
  }));

// --- the whole loop against a fake Ollama ----------------------------------------------------

test('the loop reads a card, proposes a change, stores everything, and ends with exactly one done', async () => {
  // A scripted model: ask to read, then to propose, then answer.
  const scripted = [
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_item', arguments: { kind: 'character', name: 'Ada' } } }] }, done: true },
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'propose_new_version', arguments: { entity: 'character', name: 'Ada', field: 'personality', content: 'Sharper personality.', summary: 'Sharpen' } } }] }, done: true },
    { message: { role: 'assistant', content: 'I proposed a sharper personality; review it and apply if you like it.' }, done: true },
  ];
  const requests: { tools?: unknown[]; messages: { role: string }[] }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.end(JSON.stringify(scripted[Math.min(requests.length - 1, scripted.length - 1)]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    await withLibrary(async (s, store) => {
      const ada = newCharacter(s, 'Ada', 'Dull personality.');
      const settings: AssistantSettings = { model: 'm', contextWindow: 16384, styleGuide: '' };
      const manager = new AssistantManager(store, new OllamaClient(() => `http://127.0.0.1:${port}`), s, () => settings);
      const conversation = store.createConversation('m');

      const events: AssistantStreamEvent[] = [];
      const finished = new Promise<void>((resolve) => {
        manager.start(conversation.id, 'Make Ada sharper', (event) => {
          events.push(event);
          if (event.type === 'done' || event.type === 'error' || event.type === 'cancelled') resolve();
        });
      });
      await finished;

      assert.deepEqual(events.filter((e) => ['done', 'error', 'cancelled'].includes(e.type)).map((e) => e.type), ['done']);
      assert.equal(requests.length, 3);
      assert.ok(requests.every((r) => r.tools && r.tools.length === ASSISTANT_TOOLS.length));
      assert.deepEqual(requests[2].messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'tool']);

      assert.deepEqual(store.getMessages(conversation.id).map((m) => m.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
      assert.equal(store.getConversation(conversation.id)!.title, 'Make Ada sharper');

      const proposals = store.listProposals(conversation.id);
      assert.equal(proposals.length, 1);
      assert.equal(proposals[0].status, 'pending');
      assert.equal((proposals[0].payload as NewVersionPayload).before, 'Dull personality.');
      assert.equal(loadLibrary(s).characters[0].personality, 'Dull personality.', 'the model alone changed nothing');

      // Applying is the user's step, and it adds a version.
      applyNewVersion(s, proposals[0].payload as NewVersionPayload);
      assert.equal(loadLibrary(s).characters[0].personality, 'Sharper personality.');
      assert.equal(ada.name, 'Ada');
    });
  } finally {
    server.close();
  }
});

test('an unreachable model server ends in one error event and stores no partial reply', async () => {
  await withLibrary(async (s, store) => {
    const settings: AssistantSettings = { model: 'm', contextWindow: 16384, styleGuide: '' };
    // Nothing listens on port 1.
    const manager = new AssistantManager(store, new OllamaClient(() => 'http://127.0.0.1:1'), s, () => settings);
    const conversation = store.createConversation('m');
    const events: AssistantStreamEvent[] = [];
    await new Promise<void>((resolve) => {
      manager.start(conversation.id, 'hello', (event) => {
        events.push(event);
        if (event.type === 'done' || event.type === 'error' || event.type === 'cancelled') resolve();
      });
    });
    assert.deepEqual(events.map((e) => e.type), ['error']);
    assert.deepEqual(store.getMessages(conversation.id).map((m) => m.role), ['user'], 'the user message is kept, no reply is invented');
    assert.equal(manager.isRunning(conversation.id), false);
  });
});

test('a locked session cannot start or read a conversation that showed hidden content', () =>
  withLibrary((s, store) => {
    const settings: AssistantSettings = { model: 'm', contextWindow: 16384, styleGuide: '' };
    const manager = new AssistantManager(store, new OllamaClient(() => 'http://127.0.0.1:1'), s, () => settings);
    const conversation = store.createConversation('m');
    store.markTouchedHidden(conversation.id);
    assert.throws(() => manager.start(conversation.id, 'hi', () => {}), /not found/);
    assert.throws(() => manager.assertAccessible(store.getConversation(conversation.id)), /not found/);
    s.security.unlock('1234');
    assert.doesNotThrow(() => manager.assertAccessible(store.getConversation(conversation.id)));
  }));

// --- rolling a turn back ---------------------------------------------------------------------

/** A fake Ollama that answers each request from `script` in order; a `null` entry never answers (a reply
 * the user stops partway). Returns the server, its port, and a way to drop any hanging connection. */
async function fakeOllama(script: (object | null)[]) {
  let calls = 0;
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const next = script[Math.min(calls++, script.length - 1)];
      if (next) res.end(JSON.stringify(next));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

const toolCalls = (...calls: { name: string; arguments: object }[]) => ({
  message: { role: 'assistant', content: '', tool_calls: calls.map((c) => ({ function: c })) },
  done: true,
});

test('stop and roll back removes the exchange, its proposals and its notes change, and keeps earlier turns', async () => {
  const model = await fakeOllama([
    toolCalls(
      { name: 'update_notes', arguments: { notes: 'the model rewrote these' } },
      { name: 'propose_create', arguments: { entity: 'persona', name: 'Zed', background: 'Wrong direction.' } }
    ),
    null, // the next reply is still being written when the user stops
  ]);
  try {
    await withLibrary(async (s, store) => {
      const settings: AssistantSettings = { model: 'm', contextWindow: 16384, styleGuide: '' };
      const manager = new AssistantManager(store, new OllamaClient(() => `http://127.0.0.1:${model.port}`), s, () => settings);
      const conversation = store.createConversation('m', 'Earlier chat');
      store.appendMessage({ conversationId: conversation.id, role: 'user', content: 'an earlier question' });
      store.appendMessage({ conversationId: conversation.id, role: 'assistant', content: 'an earlier answer' });
      store.setNotes(conversation.id, 'notes before the turn');

      const events: AssistantStreamEvent[] = [];
      manager.start(conversation.id, 'Make a persona', (event) => events.push(event));
      // Wait until the model has proposed something and is mid-way through its next reply.
      for (let i = 0; i < 200 && !(store.listProposals(conversation.id).length === 1 && manager.isRunning(conversation.id)); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(store.listProposals(conversation.id).length, 1, 'the proposal exists before the rollback');
      assert.equal(store.getConversation(conversation.id)!.notes, 'the model rewrote these');

      const result = await manager.rollbackLastTurn(conversation.id);

      assert.equal(result.content, 'Make a persona', 'the text comes back for the box');
      assert.deepEqual(store.getMessages(conversation.id).map((m) => m.content), ['an earlier question', 'an earlier answer']);
      assert.equal(store.listProposals(conversation.id).length, 0, 'no orphaned proposal is left behind');
      assert.equal(store.getConversation(conversation.id)!.notes, 'notes before the turn');
      assert.equal(store.getConversation(conversation.id)!.title, 'Earlier chat', 'an earlier title is kept');
      assert.equal(manager.isRunning(conversation.id), false);
      assert.deepEqual(events.filter((e) => ['done', 'error', 'cancelled'].includes(e.type)).map((e) => e.type), ['cancelled']);
      assert.equal(s.conversations.listPersonas().length, 0, 'nothing reached the library');
    });
  } finally {
    model.close();
  }
});

test('rolling back the only exchange leaves the conversation untitled again', async () => {
  const model = await fakeOllama([null]);
  try {
    await withLibrary(async (s, store) => {
      const settings: AssistantSettings = { model: 'm', contextWindow: 16384, styleGuide: '' };
      const manager = new AssistantManager(store, new OllamaClient(() => `http://127.0.0.1:${model.port}`), s, () => settings);
      const conversation = store.createConversation('m');
      manager.start(conversation.id, 'Wrong start', () => {});
      assert.equal(store.getConversation(conversation.id)!.title, 'Wrong start');
      await manager.rollbackLastTurn(conversation.id);
      assert.equal(store.getMessages(conversation.id).length, 0);
      assert.equal(store.getConversation(conversation.id)!.title, 'New conversation');
      await assert.rejects(manager.rollbackLastTurn(conversation.id), /nothing to roll back/);
    });
  } finally {
    model.close();
  }
});

test('a rollback is refused, and changes nothing, once a proposal from that exchange was applied', async () => {
  const model = await fakeOllama([
    toolCalls({ name: 'propose_create', arguments: { entity: 'persona', name: 'Zed', background: 'Keeper.' } }),
    { message: { role: 'assistant', content: 'Proposed Zed.' }, done: true },
  ]);
  try {
    await withLibrary(async (s, store) => {
      const settings: AssistantSettings = { model: 'm', contextWindow: 16384, styleGuide: '' };
      const manager = new AssistantManager(store, new OllamaClient(() => `http://127.0.0.1:${model.port}`), s, () => settings);
      const conversation = store.createConversation('m');
      await new Promise<void>((resolve) => {
        manager.start(conversation.id, 'Make Zed', (e) => (e.type === 'done' || e.type === 'error') && resolve());
      });
      const [proposal] = store.listProposals(conversation.id);
      applyCreate(s, proposal.payload as CreatePayload);
      store.setProposalStatus(proposal.id, 'applied');

      const before = store.getMessages(conversation.id).length;
      await assert.rejects(manager.rollbackLastTurn(conversation.id), /already applied/);
      assert.equal(store.getMessages(conversation.id).length, before, 'nothing was deleted');
      assert.equal(store.listProposals(conversation.id).length, 1);
      assert.equal(s.conversations.listPersonas().length, 1, 'the applied persona is untouched');
    });
  } finally {
    model.close();
  }
});

// --- reconnecting to a run in progress -------------------------------------------------------

test('a running reply can be read back from its start, for a page that was left and reopened', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      if (calls === 1) {
        // Turn one: some text and a tool call. Its text is stored as its own message once the turn ends.
        res.end(JSON.stringify({ message: { role: 'assistant', content: 'Let me look.', tool_calls: [{ function: { name: 'list_library', arguments: {} } }] }, done: true }));
        return;
      }
      // Turn two streams in pieces and is still writing when the page reconnects.
      res.write(JSON.stringify({ message: { content: 'Here is ' }, done: false }) + '\n');
      res.write(JSON.stringify({ message: { content: 'what I found, ' }, done: false }) + '\n');
      void gate.then(() => res.end(JSON.stringify({ message: { content: 'all of it.' }, done: true }) + '\n'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    await withLibrary(async (s, store) => {
      const settings: AssistantSettings = { model: 'm', contextWindow: 16384, styleGuide: '' };
      const manager = new AssistantManager(store, new OllamaClient(() => `http://127.0.0.1:${port}`), s, () => settings);
      const conversation = store.createConversation('m');

      assert.equal(manager.getLive(conversation.id), null, 'nothing is live before a run');
      const events: AssistantStreamEvent[] = [];
      const finished = new Promise<void>((resolve) => {
        manager.start(conversation.id, 'What do I have?', (event) => {
          events.push(event);
          if (event.type === 'done' || event.type === 'error') resolve();
        });
      });

      for (let i = 0; i < 300 && !manager.getLive(conversation.id)?.text.includes('what I found, '); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // This is what a reopened page is given: the reply from its first word, not just from now on, and
      // none of the previous turn's text (that one is stored, and comes back with the messages).
      const live = manager.getLive(conversation.id)!;
      assert.equal(live.text, 'Here is what I found, ');
      assert.deepEqual(live.calls, [], 'the earlier tool call has finished');
      assert.equal(manager.isRunning(conversation.id), true);
      assert.deepEqual(store.getMessages(conversation.id).map((m) => m.role), ['user', 'assistant', 'tool'], 'the earlier turn is stored');

      release();
      await finished;
      assert.equal(manager.getLive(conversation.id), null, 'nothing is live once the run ends');
      assert.equal(store.getMessages(conversation.id).at(-1)!.content, 'Here is what I found, all of it.');
    });
  } finally {
    release();
    server.close();
  }
});

test('the tools in flight are readable while a turn runs, and clear when their results are in', async () => {
  const model = await fakeOllama([null]); // the model never answers: the run stays in its first turn
  try {
    await withLibrary(async (s, store) => {
      const settings: AssistantSettings = { model: 'm', contextWindow: 16384, styleGuide: '' };
      const manager = new AssistantManager(store, new OllamaClient(() => `http://127.0.0.1:${model.port}`), s, () => settings);
      const conversation = store.createConversation('m');
      manager.start(conversation.id, 'hello', () => {});
      assert.deepEqual(manager.getLive(conversation.id), { text: '', calls: [] });
      await manager.rollbackLastTurn(conversation.id);
      assert.equal(manager.getLive(conversation.id), null, 'cleared when the run is stopped');
    });
  } finally {
    model.close();
  }
});
