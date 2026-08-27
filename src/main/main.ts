import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import { initDatabase, closeDatabase, transaction } from './database/schema';
import {
  getEffectiveDbPath,
  getDefaultDbPath,
  isUsingDefaultLocation,
  setDbPath,
  resetToDefaultDbPath,
} from './dbLocation';
import { openWithRecovery } from './dbRecovery';
import { CharacterService } from './database/characterService';
import { CharacterFieldService } from './database/characterFieldService';
import { FieldVersionService } from './database/fieldVersionService';
import { CharacterImageService } from './database/characterImageService';
import { ConversationService } from './database/conversationService';
import { LorebookService } from './database/lorebookService';
import { PromptBuilder } from './chat/promptBuilder';
import { OllamaClient } from './chat/ollamaClient';
import { ChatSessionManager } from './chat/chatSession';
import { chooseCharacterImage, deleteCharacterImage, cloneCharacterImage } from './images';
import { parseCharacterHtml, resolveLocalAvatarPath } from './htmlImport';
import { CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';
import { FIELD_TYPES } from '../shared/types/characterField';
import { CreateConversationInput } from '../shared/types/conversation';
import { CreateUserPersonaInput, UpdateUserPersonaInput } from '../shared/types/userPersona';
import { ChatSendRequest, ChatStreamEvent } from '../shared/types/chat';
import {
  CreateLorebookInput,
  UpdateLorebookInput,
  CreateLorebookEntryInput,
  UpdateLorebookEntryInput,
} from '../shared/types/lorebook';
import { randomUUID } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';

// Packaged builds resolve app.getPath('userData') from build.productName ("RolePlaymate"),
// while `electron .` in dev resolves it from package.json's "name" ("roleplaymate") -- pin it
// so both modes always read/write the same data folder instead of silently diverging.
app.setName('roleplaymate');

// Without this, a second launch (a second double-click, or Windows re-running the exe after
// an install) starts a whole second process rather than reusing the first. If the first one
// is stuck -- see the startup error handling below -- every relaunch attempt just adds
// another silent zombie process instead of surfacing anything, which is exactly what a
// process list showing several idle copies with no window looks like.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/**
 * Writes a line to `userData/main.log` and, before any window exists to show a dialog to,
 * writes to stderr too. `userData` is created lazily by Electron itself, so this never
 * assumes the directory is already there.
 *
 * Startup failures here previously vanished: `app.whenReady().then(...)` had no `.catch`,
 * so a thrown error (a locked or corrupted database file, a malformed app-config.json, an
 * antivirus/sync-folder file lock) rejected into nothing. The process stayed alive as an
 * Electron process with no window and no visible error -- indistinguishable from "frozen".
 */
function logStartupFailure(context: string, error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const line = `[${new Date().toISOString()}] ${context}: ${message}\n`;
  process.stderr.write(line);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'), line);
  } catch {
    // The log write itself failing (e.g. the same locked-folder problem that caused the
    // original error) must not stop the dialog below from at least trying to show.
  }
}

function showStartupFailureDialog(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(
    'RolePlaymate failed to start',
    `${message}\n\nDetails were written to:\n${path.join(app.getPath('userData'), 'main.log')}`
  );
}

/**
 * Opens the database, recovering when the configured path can't be reached -- most commonly
 * a custom location (dbLocation.setDbPath) on a drive or network share that isn't currently
 * connected. Without this, that failure fell through to the generic startup dialog above and
 * quit: there was no way to go mount the drive and try again short of relaunching the app.
 *
 * Retry re-reads the path each attempt, so it also covers "I fixed it, try again" for a
 * transient permission or lock issue on the default location, not just missing drives.
 */
function openDatabaseWithRecovery(): DatabaseSync {
  return openWithRecovery<DatabaseSync>({
    getPath: getEffectiveDbPath,
    open: (dbPath) => initDatabase(dbPath),
    promptUser: (dbPath, error) => {
      logStartupFailure('database open', error);
      const message = error instanceof Error ? error.message : String(error);
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Database not found',
        message: "RolePlaymate can't open its database.",
        detail:
          `Location: ${dbPath}\n\n${message}\n\n` +
          'If this is on a drive or network location that isn’t currently connected, ' +
          'connect it and choose Retry. Otherwise choose a different location.',
        buttons: ['Retry', 'Choose Database Location…', 'Quit'],
        defaultId: 0,
        cancelId: 2,
      });
      return choice === 0 ? 'retry' : choice === 1 ? 'choose' : 'quit';
    },
    pickNewPath: () =>
      dialog.showSaveDialogSync({
        title: 'Choose a database location',
        defaultPath: getDefaultDbPath(),
        filters: [{ name: 'RolePlaymate database', extensions: ['db'] }],
      }) ?? null,
    // setDbPath copies the current file to the new location when one exists there -- but the
    // path we're recovering from is by definition unreachable, so fs.existsSync on it just
    // returns false (it doesn't throw) and this adopts the new path outright, same as picking
    // a location for the first time from Settings.
    adoptPath: setDbPath,
    onGiveUp: (error) => {
      showStartupFailureDialog(error);
      app.quit();
    },
  });
}

process.on('uncaughtException', (error) => {
  logStartupFailure('uncaughtException', error);
  showStartupFailureDialog(error);
  app.quit();
});

let mainWindow: BrowserWindow | null = null;
let db: DatabaseSync | null = null;
let characterService: CharacterService;
let fieldService: CharacterFieldService;
let fieldVersionService: FieldVersionService;
let characterImageService: CharacterImageService;
let conversationService: ConversationService;
let promptBuilder: PromptBuilder;
let ollamaClient: OllamaClient;
let chatSessions: ChatSessionManager;
let lorebookService: LorebookService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '../../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'default',
    backgroundColor: '#f5f5f5',
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    dialog
      .showMessageBox(mainWindow!, {
        type: 'info',
        title: 'Update ready',
        message: `RolePlaymate ${info.version} has been downloaded.`,
        detail: 'Restart now to install it, or it will install automatically the next time you quit.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Failed to check for updates:', err);
  });
}

interface UpdateCheckResult {
  status: 'available' | 'not-available' | 'error' | 'unsupported';
  version?: string;
  message?: string;
}

function checkForUpdatesNow(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return Promise.resolve({ status: 'unsupported' });
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
    };
    const onAvailable = (info: { version: string }) => {
      cleanup();
      resolve({ status: 'available', version: info.version });
    };
    const onNotAvailable = () => {
      cleanup();
      resolve({ status: 'not-available' });
    };
    const onError = (err: Error) => {
      cleanup();
      const message = err?.message ?? String(err);
      resolve({
        status: 'error',
        message: message.includes('Cannot find latest')
          ? 'A new version may still be uploading -- try again in a few minutes.'
          : message,
      });
    };

    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);
    autoUpdater.checkForUpdates().catch(onError);
  });
}

app.whenReady().then(() => {
  db = openDatabaseWithRecovery();
  characterService = new CharacterService(db);
  fieldService = new CharacterFieldService(db);
  fieldVersionService = new FieldVersionService(db);
  characterImageService = new CharacterImageService(db);
  conversationService = new ConversationService(db);
  promptBuilder = new PromptBuilder(characterService, fieldService, fieldVersionService);
  ollamaClient = new OllamaClient();
  lorebookService = new LorebookService(db);
  chatSessions = new ChatSessionManager(
    conversationService,
    promptBuilder,
    ollamaClient,
    lorebookService
  );

  registerIPCHandlers();

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  // Anything above -- most plausibly `initDatabase()` hitting a locked, corrupted, or
  // permission-denied database file -- used to reject this promise with nothing downstream
  // to catch it. The process survived with no window and no error, which looks exactly like
  // "the app doesn't open": alive in the task list, using almost no resources, forever.
  logStartupFailure('startup', error);
  showStartupFailureDialog(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Closing the database belongs here rather than in `window-all-closed`: on macOS that fires
// without quitting, and a closed handle would break the `activate` -> createWindow path.
app.on('before-quit', () => {
  closeDatabase();
  db = null;
});

function registerIPCHandlers() {
  // Character handlers
  ipcMain.handle('characters:getAll', () => characterService.getAllCharacters());
  ipcMain.handle('characters:getById', (_, id: string) => characterService.getCharacterById(id));

  // Creating a character also creates its three fixed fields (personality/scenario/greeting),
  // each with a blank first version -- unlike TrackDraft's freely-added Parts, a character's
  // fields are a fixed set, so there's no separate "add field" action.
  ipcMain.handle('characters:create', (_, input: CreateCharacterInput) =>
    transaction(db!, () => {
      const character = characterService.createCharacter(input);
      for (const fieldType of FIELD_TYPES) {
        const field = fieldService.createField(character.id, fieldType);
        fieldVersionService.createVersion({ fieldId: field.id, content: '' });
      }
      return character;
    })
  );

  ipcMain.handle('characters:update', (_, id: string, input: UpdateCharacterInput) =>
    characterService.updateCharacter(id, input)
  );

  // Clones a character's name (suffixed), every portrait image, and every field's full
  // version history into a brand-new character -- independent from the source from that
  // point on.
  ipcMain.handle('characters:clone', (_, id: string) => {
    const source = characterService.getCharacterById(id);
    if (!source) {
      throw new Error(`Character with id ${id} not found`);
    }

    // Copy the image files up front, outside the transaction: file writes can't be rolled
    // back, so doing them inside would leave the DB consistent but the disk not. If the
    // transaction below fails, these copies are orphaned in userData/images -- unreferenced
    // and harmless, which is a better trade than the machinery to undo them.
    const clonedImagePaths = characterImageService
      .getImagesByCharacter(source.id)
      .map((image) => cloneCharacterImage(image.path))
      .filter((clonedPath): clonedPath is string => clonedPath !== null);

    const sourceFields = fieldService.getFieldsByCharacter(source.id);
    const sourceVersionsByType = new Map(
      FIELD_TYPES.map((fieldType) => {
        const sourceField = sourceFields.find((f) => f.fieldType === fieldType);
        return [fieldType, sourceField ? fieldVersionService.getVersionsByField(sourceField.id) : []];
      })
    );

    return transaction(db!, () => {
      const cloned = characterService.createCharacter({
        name: `${source.name} (Copy)`,
        description: source.description ?? undefined,
      });

      for (const clonedPath of clonedImagePaths) {
        characterImageService.addImage(cloned.id, clonedPath);
      }

      for (const fieldType of FIELD_TYPES) {
        const newField = fieldService.createField(cloned.id, fieldType);
        const sourceVersions = sourceVersionsByType.get(fieldType) ?? [];

        if (sourceVersions.length === 0) {
          fieldVersionService.createVersion({ fieldId: newField.id, content: '' });
        } else {
          for (const version of sourceVersions) {
            fieldVersionService.createVersion({ fieldId: newField.id, content: version.content });
          }
        }
      }

      return characterService.getCharacterById(cloned.id)!;
    });
  });

  ipcMain.handle('characters:delete', (_, id: string) => {
    const images = characterImageService.getImagesByCharacter(id);
    characterService.deleteCharacter(id);
    for (const image of images) deleteCharacterImage(image.path);
    return { success: true };
  });

  // Imports a character from a saved chatbot-profile HTML page (tested against SpicyChat's
  // "Save Page As..." export). Parses name/description/fields programmatically, skipping and
  // reporting anything it can't find rather than failing the whole import.
  ipcMain.handle('characters:importFromHtml', async () => {
    if (!mainWindow) return null;

    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Import character from HTML',
      properties: ['openFile'],
      filters: [{ name: 'HTML pages', extensions: ['html', 'htm'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const htmlFilePath = picked.filePaths[0];
    const html = fs.readFileSync(htmlFilePath, 'utf-8');
    const parsed = parseCharacterHtml(html);

    // Copy the portrait before opening the transaction, for the same reason as in
    // characters:clone -- file writes aren't transactional.
    const localAvatarPath = resolveLocalAvatarPath(htmlFilePath, parsed.avatarSrc);
    const copiedPath = localAvatarPath ? cloneCharacterImage(localAvatarPath) : null;

    const character = transaction(db!, () => {
      const created = characterService.createCharacter({
        name: parsed.name,
        description: parsed.description ?? undefined,
      });

      for (const fieldType of FIELD_TYPES) {
        const field = fieldService.createField(created.id, fieldType);
        fieldVersionService.createVersion({
          fieldId: field.id,
          content: parsed.fields[fieldType] ?? '',
        });
      }

      if (copiedPath) {
        characterImageService.addImage(created.id, copiedPath);
      }

      return created;
    });

    if (localAvatarPath) {
      if (!copiedPath) {
        parsed.warnings.push('Found a portrait image but could not copy it.');
      }
    } else if (parsed.avatarSrc) {
      parsed.warnings.push(
        'Portrait image was not found next to the HTML file -- save the page as "Webpage, Complete" to include it, or add one manually.'
      );
    }

    return { character: characterService.getCharacterById(character.id)!, warnings: parsed.warnings };
  });

  // Field (content) handlers
  ipcMain.handle('fields:getByCharacter', (_, characterId: string) => fieldService.getFieldsByCharacter(characterId));

  // Field version handlers
  ipcMain.handle('fieldVersions:getByField', (_, fieldId: string) => fieldVersionService.getVersionsByField(fieldId));
  ipcMain.handle('fieldVersions:getById', (_, id: string) => fieldVersionService.getVersionById(id));
  ipcMain.handle('fieldVersions:duplicate', (_, versionId: string) => fieldVersionService.duplicateVersion(versionId));
  ipcMain.handle('fieldVersions:updateContent', (_, id: string, content: string) =>
    fieldVersionService.updateVersionContent(id, content)
  );
  ipcMain.handle('fieldVersions:delete', (_, id: string) => {
    fieldVersionService.deleteVersion(id);
    return { success: true };
  });

  // Character image (gallery) handlers
  ipcMain.handle('characterImages:getByCharacter', (_, characterId: string) =>
    characterImageService.getImagesByCharacter(characterId)
  );
  ipcMain.handle('characterImages:getAllGroupedByCharacter', () => characterImageService.getAllGroupedByCharacter());
  ipcMain.handle('characterImages:add', async (_, characterId: string) => {
    const path = await chooseCharacterImage(mainWindow);
    if (!path) return null;
    return characterImageService.addImage(characterId, path);
  });
  ipcMain.handle('characterImages:remove', (_, id: string) => {
    const existing = characterImageService.getImageById(id);
    characterImageService.removeImage(id);
    if (existing) deleteCharacterImage(existing.path);
    return { success: true };
  });

  // Database location handlers
  ipcMain.handle('dbLocation:get', () => ({
    path: getEffectiveDbPath(),
    isDefault: isUsingDefaultLocation(),
    defaultPath: getDefaultDbPath(),
  }));

  ipcMain.handle('dbLocation:browseExisting', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an existing RolePlaymate database file',
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dbLocation:browseNew', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Choose where to store the RolePlaymate database',
      defaultPath: 'roleplaymate.db',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  });

  ipcMain.handle('dbLocation:set', (_, newPath: string) => {
    // Must close before setDbPath copies the file: under WAL the most recent commits can
    // still be sitting in the `-wal` sidecar, and a clean close() checkpoints them in.
    closeDatabase();
    db = null;
    setDbPath(newPath);
    app.relaunch();
    app.exit();
    return { success: true };
  });

  ipcMain.handle('dbLocation:resetToDefault', () => {
    closeDatabase();
    db = null;
    resetToDefaultDbPath();
    app.relaunch();
    app.exit();
    return { success: true };
  });

  // Chat handlers.
  //
  // Only prompt composition so far -- no model is involved yet. This exists so the
  // assembled prompt (macro substitution, section order, which fields contributed, the
  // greeting that would seed the conversation) can be inspected on its own, before
  // streaming and Ollama are wired up and failures get harder to attribute.
  ipcMain.handle(
    'chat:previewSystemPrompt',
    (_, characterId: string, options?: { personaId?: string; directions?: string; memories?: string[] }) => {
      const persona = options?.personaId ? conversationService.getPersona(options.personaId) : null;
      return promptBuilder.buildSystemPrompt(characterId, {
        personaName: persona?.name ?? null,
        personaBackground: persona?.background ?? null,
        directions: options?.directions,
        memories: options?.memories,
      });
    }
  );

  ipcMain.handle('personas:getAll', () => conversationService.listPersonas());
  ipcMain.handle('personas:create', (_, input: CreateUserPersonaInput) =>
    conversationService.createPersona(input)
  );
  ipcMain.handle('personas:update', (_, id: string, input: UpdateUserPersonaInput) =>
    conversationService.updatePersona(id, input)
  );
  ipcMain.handle('personas:delete', (_, id: string) => {
    conversationService.deletePersona(id);
    return { success: true };
  });

  // Conversation handlers
  ipcMain.handle('conversations:getAll', () => conversationService.listConversations());
  ipcMain.handle('conversations:getById', (_, id: string) => conversationService.getConversation(id));
  ipcMain.handle('conversations:getMessages', (_, id: string) => conversationService.getMessages(id));

  // Seeds the character's active greeting as the opening assistant message, so it lands in
  // the transcript and in the model's context rather than being a render-time flourish.
  ipcMain.handle('conversations:create', (_, input: CreateConversationInput) => {
    // Resolve the persona first: the greeting contains {{user}}, so building it without the
    // persona would greet "User" by name in a conversation that has one selected.
    const persona = input.userPersonaId
      ? conversationService.getPersona(input.userPersonaId)
      : null;
    const built = promptBuilder.buildSystemPrompt(input.characterId, {
      personaName: persona?.name ?? null,
      personaBackground: persona?.background ?? null,
    });
    return conversationService.createConversation({ ...input, greeting: built.greeting });
  });

  ipcMain.handle('conversations:rename', (_, id: string, title: string) =>
    conversationService.renameConversation(id, title)
  );

  ipcMain.handle('conversations:delete', (_, id: string) => {
    chatSessions.dropSession(id);
    conversationService.deleteConversation(id);
    return { success: true };
  });

  // Ollama handlers -- the app stays fully usable when the server is absent, so these
  // report unavailability rather than throwing it at the user as an unhandled rejection.
  ipcMain.handle('ollama:listModels', async () => {
    try {
      return { available: true as const, models: await ollamaClient.listModels() };
    } catch (error) {
      return { available: false as const, models: [], message: (error as Error).message };
    }
  });

  registerLorebookHandlers();
  registerChatHandlers();

  // App / update handlers
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('updates:check', () => checkForUpdatesNow());
}

function registerLorebookHandlers() {
  ipcMain.handle('lorebooks:getWorldBooks', () => lorebookService.listWorldBooks());
  ipcMain.handle('lorebooks:getById', (_, id: string) => lorebookService.getBook(id));
  ipcMain.handle('lorebooks:create', (_, input: CreateLorebookInput) =>
    lorebookService.createBook(input)
  );
  ipcMain.handle('lorebooks:update', (_, id: string, input: UpdateLorebookInput) =>
    lorebookService.updateBook(id, input)
  );
  ipcMain.handle('lorebooks:delete', (_, id: string) => {
    lorebookService.deleteBook(id);
    return { success: true };
  });

  // A character's personal book is created on demand rather than alongside every character,
  // so characters that never need one don't accumulate empty books.
  ipcMain.handle('lorebooks:getPersonalBook', (_, characterId: string) => {
    const character = characterService.getCharacterById(characterId);
    if (!character) throw new Error(`Character with id ${characterId} not found`);
    return lorebookService.getOrCreatePersonalBook(characterId, character.name);
  });

  ipcMain.handle('lorebooks:getForCharacter', (_, characterId: string) =>
    lorebookService.getBooksForCharacter(characterId)
  );
  ipcMain.handle('lorebooks:getCharacterIds', (_, lorebookId: string) =>
    lorebookService.getCharacterIdsForBook(lorebookId)
  );
  ipcMain.handle('lorebooks:attach', (_, characterId: string, lorebookId: string) => {
    lorebookService.attachBook(characterId, lorebookId);
    return { success: true };
  });
  ipcMain.handle('lorebooks:detach', (_, characterId: string, lorebookId: string) => {
    lorebookService.detachBook(characterId, lorebookId);
    return { success: true };
  });

  // Entries
  ipcMain.handle('loreEntries:getByBook', (_, lorebookId: string) =>
    lorebookService.listEntries(lorebookId)
  );
  ipcMain.handle('loreEntries:create', (_, input: CreateLorebookEntryInput) =>
    lorebookService.createEntry(input)
  );
  ipcMain.handle('loreEntries:update', (_, id: string, input: UpdateLorebookEntryInput) =>
    lorebookService.updateEntry(id, input)
  );
  ipcMain.handle('loreEntries:delete', (_, id: string) => {
    lorebookService.deleteEntry(id);
    return { success: true };
  });

  // Entry versions -- same operations the character field editor offers.
  ipcMain.handle('loreVersions:getByEntry', (_, entryId: string) =>
    lorebookService.getVersions(entryId)
  );
  ipcMain.handle('loreVersions:create', (_, entryId: string, content: string) =>
    lorebookService.createVersion(entryId, content)
  );
  ipcMain.handle('loreVersions:updateContent', (_, versionId: string, content: string) =>
    lorebookService.updateVersionContent(versionId, content)
  );
  ipcMain.handle('loreVersions:delete', (_, versionId: string) => {
    lorebookService.deleteVersion(versionId);
    return { success: true };
  });
}

/**
 * Chat is the only feature here that pushes to the renderer rather than answering it: a
 * reply arrives token by token, so `chat:send` returns a streamId immediately and the tokens
 * follow as events.
 *
 * One channel carrying a discriminated union, not four channels -- one listener
 * registration, one switch, one cleanup path in the renderer.
 */
function registerChatHandlers() {
  ipcMain.handle('chat:send', (event, request: ChatSendRequest & { characterId: string; personaId?: string; model: string }) => {
    const streamId = randomUUID();
    const sender = event.sender;

    const send = (payload: ChatStreamEvent) => {
      // The window can close mid-stream; sending to a destroyed webContents throws.
      if (!sender.isDestroyed()) sender.send('chat:stream', payload);
    };

    const persona = request.personaId ? conversationService.getPersona(request.personaId) : null;

    // Deliberately not awaited: the handler returns the streamId straight away so the
    // renderer can subscribe before tokens start arriving.
    void (async () => {
      try {
        const { message, debug } = await chatSessions.generate(
          {
            conversationId: request.conversationId,
            characterId: request.characterId,
            personaName: persona?.name ?? null,
            personaBackground: persona?.background ?? null,
            userMessage: request.message,
            model: request.model,
            directions: request.directions,
            samplers: request.samplers,
          },
          (text) => send({ streamId, type: 'token', text })
        );
        send({ streamId, type: 'done', message, debug });
      } catch (error) {
        // A cancel is a user action, not a failure -- the renderer treats them differently.
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
          send({ streamId, type: 'cancelled' });
        } else {
          send({ streamId, type: 'error', message: (error as Error).message });
        }
      }
    })();

    return { streamId };
  });

  // Extraction outlives the request that triggered it, so its result is pushed rather than
  // returned. Broadcast to every window: two windows can have the same conversation open.
  chatSessions.onMemoriesExtracted = (conversationId, added) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:memories-updated', { conversationId, added });
      }
    }
  };

  ipcMain.handle('memories:getAll', (_, conversationId: string) =>
    conversationService.listMemories(conversationId)
  );

  ipcMain.handle('memories:count', (_, conversationId: string) =>
    conversationService.countMemories(conversationId)
  );

  // Manually added memories are 'manual', which makes them pinned: always injected,
  // bypassing both the similarity threshold and the token budget.
  ipcMain.handle('memories:add', (_, conversationId: string, content: string) =>
    conversationService.addMemory({ conversationId, content, source: 'manual' })
  );

  ipcMain.handle('memories:update', (_, id: string, content: string) =>
    conversationService.updateMemory(id, content)
  );

  ipcMain.handle('memories:delete', (_, id: string) => {
    conversationService.deleteMemory(id);
    return { success: true };
  });

  ipcMain.handle('memories:deleteAll', (_, conversationId: string) => {
    conversationService.deleteAllMemories(conversationId);
    return { success: true };
  });

  ipcMain.handle('chat:cancel', (_, conversationId: string) => ({
    cancelled: chatSessions.cancel(conversationId),
  }));

  ipcMain.handle('chat:isGenerating', (_, conversationId: string) =>
    chatSessions.isGenerating(conversationId)
  );
}
