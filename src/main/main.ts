import { app, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { initDatabase, closeDatabase, transaction } from './database/schema';
import {
  getEffectiveDbPath,
  getDefaultDbPath,
  isUsingDefaultLocation,
  setDbPath,
  resetToDefaultDbPath,
  revealDbInFileManager,
  getEffectiveOllamaHost,
  isUsingDefaultOllamaHost,
  setOllamaHost,
  resetOllamaHost,
} from './dbLocation';
import { openWithRecovery } from './dbRecovery';
import { CharacterService } from './database/characterService';
import { CharacterFieldService } from './database/characterFieldService';
import { FieldVersionService } from './database/fieldVersionService';
import { CharacterImageService } from './database/characterImageService';
import { PersonaImageService } from './database/personaImageService';
import { PersonaFieldVersionService } from './database/personaFieldVersionService';
import { ScenarioService } from './database/scenarioService';
import { ScenarioImageService } from './database/scenarioImageService';
import { ModelSamplerService } from './database/modelSamplerService';
import { ConversationService } from './database/conversationService';
import { LorebookService } from './database/lorebookService';
import { SecurityService } from './database/securityService';
import { PromptBuilder } from './chat/promptBuilder';
import { PromptSettingsService, ResettableField } from './database/promptSettingsService';
import { PromptFieldVersionService } from './database/promptFieldVersionService';
import { DEFAULT_STOP_PHRASES } from './chat/promptTemplates';
import { PromptTemplates, StopPhraseSettings, TEMPLATE_FIELD_KEYS } from '../shared/types/promptTemplates';
import { OllamaClient, DEFAULT_OLLAMA_HOST } from './chat/ollamaClient';
import { ChatSessionManager, DEFAULT_SAMPLERS } from './chat/chatSession';
import {
  chooseCharacterImage,
  chooseCharacterImages,
  deleteCharacterImage,
  cloneCharacterImage,
  getImagesDir,
} from './images';
import { parseCharacterHtml, parseLorebookHtml, resolveLocalAvatarPath } from './htmlImport';
import { parseLorebookJson } from './lorebookJsonImport';
import { CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';
import { FIELD_TYPES } from '../shared/types/characterField';
import { CreateConversationInput } from '../shared/types/conversation';
import { CreateScenarioInput, UpdateScenarioInput } from '../shared/types/scenario';
import { CreateUserPersonaInput, UpdateUserPersonaInput } from '../shared/types/userPersona';
import {
  ChatSendRequest,
  ChatRegenerateRequest,
  ChatEditPriorMessageRequest,
  ChatStreamEvent,
  SamplerParams,
} from '../shared/types/chat';
import {
  CreateLorebookInput,
  UpdateLorebookInput,
  CreateLorebookEntryInput,
  UpdateLorebookEntryInput,
} from '../shared/types/lorebook';
import {
  guardCharacterCreate,
  guardCharacterUpdate,
  guardScenarioCreate,
  guardScenarioUpdate,
  guardPersonaCreate,
  guardPersonaUpdate,
  guardLorebookCreate,
  guardLorebookUpdate,
  guardLoreEntryCreate,
  guardLoreEntryUpdate,
  guardProseContent,
  guardGreeting,
  guardLoreText,
  guardChatMessage,
  guardDirections,
  guardMemory,
  guardStopPhrasesUpdate,
  guardUrl,
  guardConversationTitle,
} from './fieldLengthGuards';
import { randomUUID } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';

// Packaged builds normally derive userData from productName ("RolePlaymate") while `electron .`
// uses package.json "name" -- pin packaged to roleplaymate for a stable folder name. Dev uses
// roleplaymate-dev with its own app-config.json and default db; nothing is copied from release.
app.setName(app.isPackaged ? 'roleplaymate' : 'roleplaymate-dev');

// Portrait <img> tags load through this instead of a raw `file://` src. Electron refuses to
// load `file://` subresources from a page whose own origin isn't `file:` -- true of the dev
// window, which loads Vite's `http://localhost:5173`, so portraits rendered fine in a
// packaged build (loaded via `file://`) but silently failed under `npm run dev`. A custom
// scheme carries no such restriction and behaves identically in both. Must be registered
// before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'rpimage', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

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
let personaImageService: PersonaImageService;
let personaFieldVersionService: PersonaFieldVersionService;
let scenarioService: ScenarioService;
let scenarioImageService: ScenarioImageService;
let modelSamplerService: ModelSamplerService;
let conversationService: ConversationService;
let promptBuilder: PromptBuilder;
let promptSettingsService: PromptSettingsService;
let promptFieldVersionService: PromptFieldVersionService;
let ollamaClient: OllamaClient;
let chatSessions: ChatSessionManager;
let lorebookService: LorebookService;
let securityService: SecurityService;

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
  // The path is the whole opaque, percent-encoded remainder after `rpimage://` (see toImageUrl
  // in the renderer) -- resolved and re-checked against the images directory rather than
  // trusted outright, since the request still originates from renderer-controlled code.
  protocol.handle('rpimage', (request) => {
    const encoded = request.url.slice('rpimage://'.length).replace(/\/+$/, '');
    const requested = path.resolve(decodeURIComponent(encoded));
    const imagesDir = getImagesDir();
    if (requested !== imagesDir && !requested.startsWith(imagesDir + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(requested).toString());
  });

  db = openDatabaseWithRecovery();
  // SecurityService first -- CharacterService, FieldVersionService, ConversationService, and
  // LorebookService all depend on it for hidden-content encryption/decryption.
  securityService = new SecurityService(db);
  fieldVersionService = new FieldVersionService(db, securityService);
  characterService = new CharacterService(db, securityService, fieldVersionService);
  fieldService = new CharacterFieldService(db);
  characterImageService = new CharacterImageService(db);
  personaImageService = new PersonaImageService(db);
  personaFieldVersionService = new PersonaFieldVersionService(db, securityService);
  scenarioService = new ScenarioService(db, securityService);
  scenarioImageService = new ScenarioImageService(db);
  conversationService = new ConversationService(db, securityService, personaFieldVersionService);
  promptSettingsService = new PromptSettingsService(db);
  promptFieldVersionService = new PromptFieldVersionService(db);
  promptBuilder = new PromptBuilder(
    characterService,
    fieldService,
    fieldVersionService,
    promptSettingsService,
    promptFieldVersionService
  );
  // A function, not a resolved string, so a host change from the settings page (see
  // ollamaHost:set below) takes effect on the client's very next request -- no restart, unlike
  // the db path, which OllamaClient never caches for that reason.
  ollamaClient = new OllamaClient(getEffectiveOllamaHost);
  lorebookService = new LorebookService(db, securityService);
  modelSamplerService = new ModelSamplerService(db);
  chatSessions = new ChatSessionManager(
    conversationService,
    promptBuilder,
    ollamaClient,
    lorebookService,
    modelSamplerService,
    scenarioService
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

  // Creating a character also creates its fixed fields (personality/greeting/dialogue), each
  // with a blank first version -- unlike TrackDraft's freely-added Parts, a character's fields
  // are a fixed set, so there's no separate "add field" action. Scenario is not among them --
  // it's a separate 1-to-N entity the user adds explicitly (see scenarios:create).
  ipcMain.handle('characters:create', (_, input: CreateCharacterInput) =>
    transaction(db!, () => {
      guardCharacterCreate(input);
      const character = characterService.createCharacter(input);
      for (const fieldType of FIELD_TYPES) {
        const field = fieldService.createField(character.id, fieldType);
        fieldVersionService.createVersion({ fieldId: field.id, content: '' });
      }
      return character;
    })
  );

  ipcMain.handle('characters:update', (_, id: string, input: UpdateCharacterInput) => {
    guardCharacterUpdate(input);
    return characterService.updateCharacter(id, input);
  });

  ipcMain.handle('characters:setHidden', (_, id: string, hidden: boolean) =>
    characterService.setHidden(id, hidden)
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

  // Imports a character from a saved chatbot-profile HTML page ("Save Page As..." export from
  // a chatbot site). Parses name/description/fields programmatically, skipping and
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

      if (parsed.scenario?.trim() || parsed.greeting?.trim()) {
        const scenario = scenarioService.createScenario(created.id, 'Imported Scenario');
        if (parsed.scenario?.trim()) {
          scenarioService.updateVersionContent(
            scenarioService.getVersions(scenario.id)[0].id,
            parsed.scenario.trim()
          );
        }
        if (parsed.greeting?.trim()) {
          scenarioService.updateGreetingVersionContent(
            scenarioService.getGreetingVersions(scenario.id)[0].id,
            parsed.greeting.trim()
          );
        }
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
  ipcMain.handle('fieldVersions:updateContent', (_, id: string, content: string) => {
    guardProseContent(content);
    return fieldVersionService.updateVersionContent(id, content);
  });
  ipcMain.handle('fieldVersions:delete', (_, id: string) => {
    fieldVersionService.deleteVersion(id);
    return { success: true };
  });

  // Character image (gallery) handlers
  ipcMain.handle('characterImages:getByCharacter', (_, characterId: string) =>
    characterImageService.getImagesByCharacter(characterId)
  );
  ipcMain.handle('characterImages:getAllGroupedByCharacter', () => characterImageService.getAllGroupedByCharacter());
  // The picker allows selecting several files at once -- the one gallery in the app where
  // more than one image per subject makes sense, so it's the one place worth the extra click
  // saved by not having to reopen the dialog per portrait.
  ipcMain.handle('characterImages:add', async (_, characterId: string) => {
    const paths = await chooseCharacterImages(mainWindow);
    return paths.map((path) => characterImageService.addImage(characterId, path));
  });
  ipcMain.handle('characterImages:remove', (_, id: string) => {
    const existing = characterImageService.getImageById(id);
    characterImageService.removeImage(id);
    if (existing) deleteCharacterImage(existing.path);
    return { success: true };
  });
  ipcMain.handle('characterImages:setCover', (_, id: string) => {
    characterImageService.setCoverImage(id);
    return { success: true };
  });

  // Persona image (gallery) handlers -- mirrors the character image handlers exactly.
  ipcMain.handle('personaImages:getByPersona', (_, personaId: string) =>
    personaImageService.getImagesByPersona(personaId)
  );
  ipcMain.handle('personaImages:getAllGroupedByPersona', () => personaImageService.getAllGroupedByPersona());
  ipcMain.handle('personaImages:add', async (_, personaId: string) => {
    const paths = await chooseCharacterImages(mainWindow);
    return paths.map((path) => personaImageService.addImage(personaId, path));
  });
  ipcMain.handle('personaImages:remove', (_, id: string) => {
    const existing = personaImageService.getImageById(id);
    personaImageService.removeImage(id);
    if (existing) deleteCharacterImage(existing.path);
    return { success: true };
  });
  ipcMain.handle('personaImages:setCover', (_, id: string) => {
    personaImageService.setCoverImage(id);
    return { success: true };
  });

  // Scenario handlers -- a character's 1-to-N settings/situations, split out from the old
  // fixed "scenario" CharacterField. See shared/types/scenario.ts.
  ipcMain.handle('scenarios:getByCharacter', (_, characterId: string) =>
    scenarioService.getScenariosByCharacter(characterId)
  );
  ipcMain.handle('scenarios:getById', (_, id: string) => scenarioService.getScenario(id));
  ipcMain.handle('scenarios:create', (_, input: CreateScenarioInput) => {
    guardScenarioCreate(input);
    return scenarioService.createScenario(input.characterId, input.name, input.description);
  });
  ipcMain.handle('scenarios:update', (_, id: string, input: UpdateScenarioInput) => {
    guardScenarioUpdate(input);
    if (input.name === undefined && input.description === undefined) {
      return scenarioService.getScenario(id)!;
    }
    return scenarioService.updateScenario(id, input);
  });
  ipcMain.handle('scenarios:setHidden', (_, id: string, hidden: boolean) =>
    scenarioService.setHidden(id, hidden)
  );
  // Same file-cleanup order as characters:delete: fetch image paths before the DB cascade
  // removes the rows, then unlink them.
  ipcMain.handle('scenarios:delete', (_, id: string) => {
    const images = scenarioImageService.getImagesByScenario(id);
    scenarioService.deleteScenario(id);
    for (const image of images) deleteCharacterImage(image.path);
    return { success: true };
  });

  // Scenario version handlers -- same shape as fieldVersions:*.
  ipcMain.handle('scenarioVersions:getByScenario', (_, scenarioId: string) =>
    scenarioService.getVersions(scenarioId)
  );
  ipcMain.handle('scenarioVersions:create', (_, scenarioId: string, content: string) => {
    guardProseContent(content, 'Scenario text');
    return scenarioService.createVersion(scenarioId, content);
  });
  ipcMain.handle('scenarioVersions:updateContent', (_, id: string, content: string) => {
    guardProseContent(content, 'Scenario text');
    return scenarioService.updateVersionContent(id, content);
  });
  ipcMain.handle('scenarioVersions:delete', (_, id: string) => {
    scenarioService.deleteVersion(id);
    return { success: true };
  });

  // Scenario greeting version handlers -- a scenario's own opening greeting, versioned
  // independently of its descriptive text. Same shape as scenarioVersions:*.
  ipcMain.handle('scenarioGreetingVersions:getByScenario', (_, scenarioId: string) =>
    scenarioService.getGreetingVersions(scenarioId)
  );
  ipcMain.handle('scenarioGreetingVersions:create', (_, scenarioId: string, content: string) => {
    guardGreeting(content);
    return scenarioService.createGreetingVersion(scenarioId, content);
  });
  ipcMain.handle('scenarioGreetingVersions:updateContent', (_, id: string, content: string) => {
    guardGreeting(content);
    return scenarioService.updateGreetingVersionContent(id, content);
  });
  ipcMain.handle('scenarioGreetingVersions:delete', (_, id: string) => {
    scenarioService.deleteGreetingVersion(id);
    return { success: true };
  });

  // Scenario image (gallery) handlers -- mirrors the character image handlers exactly.
  ipcMain.handle('scenarioImages:getByScenario', (_, scenarioId: string) =>
    scenarioImageService.getImagesByScenario(scenarioId)
  );
  ipcMain.handle('scenarioImages:add', async (_, scenarioId: string) => {
    const paths = await chooseCharacterImages(mainWindow);
    return paths.map((path) => scenarioImageService.addImage(scenarioId, path));
  });
  ipcMain.handle('scenarioImages:remove', (_, id: string) => {
    const existing = scenarioImageService.getImageById(id);
    scenarioImageService.removeImage(id);
    if (existing) deleteCharacterImage(existing.path);
    return { success: true };
  });
  ipcMain.handle('scenarioImages:setCover', (_, id: string) => {
    scenarioImageService.setCoverImage(id);
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

  ipcMain.handle('dbLocation:showInFolder', async () => {
    await revealDbInFileManager();
    return { success: true };
  });

  // Ollama server location -- unlike the db path, takes effect immediately on the next
  // request, no relaunch needed (see the hostProvider comment where OllamaClient is built).
  ipcMain.handle('ollamaHost:get', () => ({
    host: getEffectiveOllamaHost(),
    isDefault: isUsingDefaultOllamaHost(),
    defaultHost: DEFAULT_OLLAMA_HOST,
  }));

  ipcMain.handle('ollamaHost:set', (_, host: string) => {
    guardUrl(host);
    setOllamaHost(host);
    return { success: true };
  });

  ipcMain.handle('ollamaHost:resetToDefault', () => {
    resetOllamaHost();
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
    (
      _,
      characterId: string,
      options?: { personaId?: string; scenarioId?: string; directions?: string; memories?: string[] }
    ) => {
      const persona = options?.personaId ? conversationService.getPersona(options.personaId) : null;
      const scenarioContent = options?.scenarioId ? scenarioService.getActiveContent(options.scenarioId) : null;
      const scenarioGreeting = options?.scenarioId ? scenarioService.getActiveGreeting(options.scenarioId) : null;
      return promptBuilder.buildSystemPrompt(characterId, {
        personaName: persona?.name ?? null,
        personaBackground: persona?.background ?? null,
        scenarioContent,
        scenarioGreeting,
        directions: options?.directions,
        memories: options?.memories,
      });
    }
  );

  ipcMain.handle('personas:getAll', () => conversationService.listPersonas());
  ipcMain.handle('personas:create', (_, input: CreateUserPersonaInput) => {
    guardPersonaCreate(input);
    return conversationService.createPersona(input);
  });
  ipcMain.handle('personas:update', (_, id: string, input: UpdateUserPersonaInput) => {
    guardPersonaUpdate(input);
    return conversationService.updatePersona(id, input);
  });

  ipcMain.handle('personas:setHidden', (_, id: string, hidden: boolean) =>
    conversationService.setPersonaHidden(id, hidden)
  );
  ipcMain.handle('personas:delete', (_, id: string) => {
    conversationService.deletePersona(id);
    return { success: true };
  });

  // Background version history -- mirrors fieldVersions:* above, keyed directly by persona
  // instead of an opaque per-character field id (a persona has exactly one versionable field).
  ipcMain.handle('personaFieldVersions:getByPersona', (_, personaId: string) =>
    personaFieldVersionService.getVersionsByPersona(personaId)
  );
  ipcMain.handle('personaFieldVersions:getById', (_, id: string) => personaFieldVersionService.getVersionById(id));
  ipcMain.handle('personaFieldVersions:duplicate', (_, versionId: string) =>
    personaFieldVersionService.duplicateVersion(versionId)
  );
  ipcMain.handle('personaFieldVersions:updateContent', (_, id: string, content: string) => {
    guardProseContent(content, 'Background');
    return personaFieldVersionService.updateVersionContent(id, content);
  });
  ipcMain.handle('personaFieldVersions:delete', (_, id: string) => {
    personaFieldVersionService.deleteVersion(id);
    return { success: true };
  });

  // Clones a persona's name (suffixed), description and background into a brand-new,
  // independent persona, then clones every gallery image the same way characters:clone does
  // (file writes aren't transactional, so this loop runs outside conversationService.clonePersona's
  // own DB write).
  ipcMain.handle('personas:clone', (_, id: string) => {
    const source = conversationService.getPersona(id);
    if (!source) throw new Error(`UserPersona with id ${id} not found`);

    const clonedImagePaths = personaImageService
      .getImagesByPersona(source.id)
      .map((image) => cloneCharacterImage(image.path))
      .filter((clonedPath): clonedPath is string => clonedPath !== null);

    const cloned = conversationService.clonePersona(id);
    for (const clonedPath of clonedImagePaths) {
      personaImageService.addImage(cloned.id, clonedPath);
    }
    return cloned;
  });

  // Conversation handlers
  ipcMain.handle('conversations:getAll', () => conversationService.listConversations());
  ipcMain.handle('conversations:getById', (_, id: string) => conversationService.getConversation(id));
  ipcMain.handle('conversations:getMessages', (_, id: string) => conversationService.getMessages(id));

  // Seeds the character's active greeting as the opening assistant message, so it lands in
  // the transcript and in the model's context rather than being a render-time flourish.
  ipcMain.handle('conversations:create', (_, input: CreateConversationInput) => {
    // Resolve the persona first: the greeting contains {{user}}, so building it without the
    // persona would greet "User" by name in a conversation that has one selected. The greeting
    // itself now comes from the selected scenario (if any) rather than the character -- no
    // scenario selected means no greeting, same as no scenario means no [SCENARIO] section.
    const persona = input.userPersonaId
      ? conversationService.getPersona(input.userPersonaId)
      : null;
    const scenarioGreeting = input.scenarioId ? scenarioService.getActiveGreeting(input.scenarioId) : null;
    const built = promptBuilder.buildSystemPrompt(input.characterId, {
      personaName: persona?.name ?? null,
      personaBackground: persona?.background ?? null,
      scenarioGreeting,
    });
    return conversationService.createConversation({ ...input, greeting: built.greeting });
  });

  ipcMain.handle('conversations:rename', (_, id: string, title: string) => {
    guardConversationTitle(title);
    return conversationService.renameConversation(id, title);
  });

  ipcMain.handle('conversations:setPersona', (_, id: string, userPersonaId: string | null) =>
    conversationService.setConversationPersona(id, userPersonaId)
  );

  ipcMain.handle('conversations:setScenario', (_, id: string, scenarioId: string | null) =>
    conversationService.setConversationScenario(id, scenarioId)
  );

  ipcMain.handle(
    'conversations:setImageMode',
    (
      _,
      id: string,
      input: {
        characterImageMode?: 'carousel' | 'static';
        characterImageId?: string | null;
        scenarioImageId?: string | null;
        personaImageMode?: 'carousel' | 'static';
        personaImageId?: string | null;
      }
    ) => conversationService.setImageMode(id, input)
  );

  ipcMain.handle('conversations:delete', (_, id: string) => {
    chatSessions.dropSession(id);
    conversationService.deleteConversation(id);
    return { success: true };
  });

  ipcMain.handle('conversations:deleteDraft', (_, id: string) => {
    const deleted = conversationService.deleteDraftConversation(id);
    if (deleted) chatSessions.dropSession(id);
    return { deleted };
  });

  ipcMain.handle('conversations:purgeDrafts', (_, exceptId?: string) => {
    const deletedIds = conversationService.purgeDraftConversations(exceptId ?? null);
    for (const id of deletedIds) chatSessions.dropSession(id);
    return { deletedIds };
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

  // Same call as ollama:listModels, but keeping the per-model metadata Ollama already reports
  // -- see the Model Tuning settings page.
  ipcMain.handle('ollama:listModelsDetailed', async () => {
    try {
      return { available: true as const, models: await ollamaClient.listModelsDetailed() };
    } catch (error) {
      return { available: false as const, models: [], message: (error as Error).message };
    }
  });

  // Model Tuning settings page -- per-model sampler defaults, layered under a chat-level
  // (Composer slider) override the same way chatSession.ts merges them for real generation.
  // See modelSamplerService.ts.
  ipcMain.handle('modelTuning:getGlobalDefaults', () => DEFAULT_SAMPLERS);
  ipcMain.handle('modelTuning:getAll', () => modelSamplerService.getAll());
  ipcMain.handle('modelTuning:getEffective', (_, model: string) =>
    modelSamplerService.getEffective(model, DEFAULT_SAMPLERS)
  );
  // What an unset field falls back to for this model -- the family-preset layer, without any
  // actually-saved override. See the Model Tuning page's per-row placeholder text.
  ipcMain.handle('modelTuning:getRecommended', (_, model: string) =>
    modelSamplerService.getRecommendedDefaults(model, DEFAULT_SAMPLERS)
  );
  ipcMain.handle('modelTuning:update', (_, model: string, partial: Partial<SamplerParams>) =>
    modelSamplerService.upsert(model, partial)
  );
  ipcMain.handle('modelTuning:resetField', (_, model: string, field: keyof SamplerParams) => {
    modelSamplerService.resetField(model, field);
    return { success: true };
  });
  ipcMain.handle('modelTuning:resetAll', (_, model: string) => {
    modelSamplerService.resetAll(model);
    return { success: true };
  });
  ipcMain.handle('modelTuning:setEnabled', (_, model: string, enabled: boolean) =>
    modelSamplerService.setEnabled(model, enabled)
  );

  registerLorebookHandlers();
  registerChatHandlers();

  // App / update handlers
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('updates:check', () => checkForUpdatesNow());

  // Prompt settings handlers -- see src/renderer/pages/PromptSettings.tsx. Templates now have
  // full version history (see promptFieldVersions:* below); this namespace is stop phrases only.
  ipcMain.handle('promptSettings:get', () => {
    const overrides = promptSettingsService.getOverrides();
    const stopPhrases: StopPhraseSettings = { ...DEFAULT_STOP_PHRASES, ...overrides.stopPhrases };
    const overriddenFields = [
      ...(overrides.stopPhrases.base !== undefined ? ['stopPhrasesBase'] : []),
      ...(overrides.stopPhrases.useCharacterNameAsStop !== undefined ? ['useCharacterNameAsStop'] : []),
      ...(overrides.stopPhrases.usePersonaNameAsStop !== undefined ? ['usePersonaNameAsStop'] : []),
    ];
    return { stopPhrases, overriddenFields };
  });
  ipcMain.handle('promptSettings:updateStopPhrases', (_, partial: Partial<StopPhraseSettings>) => {
    guardStopPhrasesUpdate(partial);
    promptSettingsService.updateStopPhrases(partial);
    return { success: true };
  });
  ipcMain.handle('promptSettings:resetField', (_, field: ResettableField) => {
    promptSettingsService.resetField(field);
    return { success: true };
  });
  // Resets both halves of the page: every template field gets a new default-content version
  // (see PromptFieldVersionService.resetToDefault), and stop phrases go back to NULL overrides.
  ipcMain.handle('promptSettings:resetAll', () => {
    for (const fieldKey of TEMPLATE_FIELD_KEYS) {
      promptFieldVersionService.resetToDefault(fieldKey);
    }
    promptSettingsService.resetAll();
    return { success: true };
  });

  // Prompt template version handlers -- mirrors fieldVersions:* above, keyed by the template's
  // fixed field key instead of a character field id. See PromptFieldVersionService.
  ipcMain.handle('promptFieldVersions:getByField', (_, fieldKey: keyof PromptTemplates) =>
    promptFieldVersionService.getVersionsByField(fieldKey)
  );
  ipcMain.handle('promptFieldVersions:getById', (_, id: string) => promptFieldVersionService.getVersionById(id));
  ipcMain.handle('promptFieldVersions:duplicate', (_, versionId: string) =>
    promptFieldVersionService.duplicateVersion(versionId)
  );
  ipcMain.handle('promptFieldVersions:updateContent', (_, id: string, content: string) => {
    guardProseContent(content, 'Template');
    return promptFieldVersionService.updateVersionContent(id, content);
  });
  ipcMain.handle('promptFieldVersions:delete', (_, id: string) => {
    promptFieldVersionService.deleteVersion(id);
    return { success: true };
  });
  ipcMain.handle('promptFieldVersions:resetToDefault', (_, fieldKey: keyof PromptTemplates) =>
    promptFieldVersionService.resetToDefault(fieldKey)
  );

  // Security handlers -- gate the "reveal hidden items" toggle, and own the encryption key
  // for actually-hidden content. `unlock` returns false on a wrong PIN rather than throwing:
  // a wrong PIN is an expected outcome, not an error.
  ipcMain.handle('security:unlock', (_, pin: string) => {
    const ok = securityService.unlock(pin);
    if (ok) {
      // One-time-per-row upgrade of any hidden content still sitting in legacy plaintext
      // (from before real encryption existed) -- cheap once everything's migrated, since each
      // row is just a prefix check.
      characterService.migrateLegacyHiddenContent();
      fieldVersionService.migrateLegacyHiddenContent();
      conversationService.migrateLegacyHiddenPersonaContent();
      personaFieldVersionService.migrateLegacyHiddenContent();
      lorebookService.migrateLegacyHiddenContent();
    }
    return ok;
  });

  ipcMain.handle('security:lock', () => {
    securityService.lock();
    return { success: true };
  });

  // A PIN change is a rekey, not just a hash swap: every currently-hidden character/persona/
  // lorebook's encrypted content is decrypted under the old key and re-encrypted under the
  // new one, in one transaction, before the new PIN is persisted -- see securityService.ts's
  // reencryptWithKeys and the plan this shipped under for why plaintext never touches disk
  // mid-rekey.
  ipcMain.handle('security:setPin', (_, currentPin: string, newPin: string) => {
    try {
      securityService.validatePinChange(currentPin, newPin);
      const oldKey = securityService.deriveKey(currentPin);
      const wasUnlocked = securityService.isUnlocked();

      transaction(db!, () => {
        // Rotates pin_hash/pin_salt/key_salt first, so deriveKey(newPin) right after reads
        // the freshly-written salt back out rather than main.ts re-deriving it by hand.
        securityService.persistNewPin(newPin);
        const newKey = securityService.deriveKey(newPin);

        characterService.reencryptHiddenContent(oldKey, newKey);
        fieldVersionService.reencryptHiddenContent(oldKey, newKey);
        conversationService.reencryptHiddenPersonaContent(oldKey, newKey);
        personaFieldVersionService.reencryptHiddenContent(oldKey, newKey);
        lorebookService.reencryptAllHiddenContent(oldKey, newKey);
        scenarioService.reencryptHiddenContent(oldKey, newKey);

        // A session that was already unlocked stays unlocked under the new key; one that was
        // locked stays locked -- changing the PIN neither requires nor grants unlock.
        if (wasUnlocked) securityService.setCachedKey(newKey);
      });

      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
  });
}

function registerLorebookHandlers() {
  ipcMain.handle('lorebooks:getWorldBooks', () => lorebookService.listWorldBooks());
  ipcMain.handle('lorebooks:getById', (_, id: string) => lorebookService.getBook(id));
  ipcMain.handle('lorebooks:create', (_, input: CreateLorebookInput) => {
    guardLorebookCreate(input);
    return lorebookService.createBook(input);
  });
  ipcMain.handle('lorebooks:update', (_, id: string, input: UpdateLorebookInput) => {
    guardLorebookUpdate(input);
    return lorebookService.updateBook(id, input);
  });
  ipcMain.handle('lorebooks:setHidden', (_, id: string, hidden: boolean) =>
    lorebookService.setHidden(id, hidden)
  );
  ipcMain.handle('lorebooks:delete', (_, id: string) => {
    lorebookService.deleteBook(id);
    return { success: true };
  });

  // Same convention as a character portrait and a persona avatar: pick, copy into
  // userData/images, hand back the path for the caller to save onto the book.
  ipcMain.handle('lorebooks:chooseImage', async () => {
    const path = await chooseCharacterImage(mainWindow);
    return path;
  });

  // Imports a world book from a saved lorebook-detail page ("Save Page As... > Webpage,
  // Complete" export from a chatbot site). Same shape as characters:importFromHtml --
  // parses what it can, reports what it couldn't find, and never fails the whole import over a
  // missing piece.
  ipcMain.handle('lorebooks:importFromHtml', async () => {
    if (!mainWindow) return null;

    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Import lorebook from HTML',
      properties: ['openFile'],
      filters: [{ name: 'HTML pages', extensions: ['html', 'htm'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const htmlFilePath = picked.filePaths[0];
    const html = fs.readFileSync(htmlFilePath, 'utf-8');
    const parsed = parseLorebookHtml(html);

    // Copy the cover image before opening the transaction, for the same reason as
    // characters:importFromHtml -- file writes aren't transactional.
    const localImagePath = resolveLocalAvatarPath(htmlFilePath, parsed.avatarSrc);
    const copiedImagePath = localImagePath ? cloneCharacterImage(localImagePath) : null;

    const lorebook = transaction(db!, () => {
      const created = lorebookService.createBook({
        name: parsed.name,
        description: parsed.description ?? undefined,
      });

      if (copiedImagePath) {
        lorebookService.updateBook(created.id, { image: copiedImagePath });
      }

      for (const entry of parsed.entries) {
        lorebookService.createEntry({
          lorebookId: created.id,
          title: entry.title,
          keys: entry.keys,
          content: entry.content,
        });
      }

      return lorebookService.getBook(created.id)!;
    });

    if (localImagePath) {
      if (!copiedImagePath) {
        parsed.warnings.push('Found a cover image but could not copy it.');
      }
    } else if (parsed.avatarSrc) {
      parsed.warnings.push(
        'Cover image was not found next to the HTML file -- save the page as "Webpage, Complete" to include it, or add one manually.'
      );
    }

    return { lorebook, warnings: parsed.warnings };
  });

  // Bulk-creates a new world book from a hand-authored JSON file -- see
  // shared/lorebookImportSample.ts for the shape and the "Copy sample JSON" buttons that hand
  // it out.
  ipcMain.handle('lorebooks:importFromJson', async () => {
    if (!mainWindow) return null;

    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Import world book from JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const parsed = parseLorebookJson(fs.readFileSync(picked.filePaths[0], 'utf-8'));
    if (!parsed.name) {
      parsed.warnings.unshift('No "name" found -- used "Imported World Book". Rename it after importing.');
    }

    const lorebook = transaction(db!, () => {
      const created = lorebookService.createBook({
        name: parsed.name ?? 'Imported World Book',
        description: parsed.description ?? undefined,
      });
      for (const entry of parsed.entries) {
        const newEntry = lorebookService.createEntry({
          lorebookId: created.id,
          title: entry.title,
          keys: entry.keys,
          content: entry.content,
          alwaysOn: entry.alwaysOn,
          priority: entry.priority,
        });
        if (!entry.enabled) lorebookService.updateEntry(newEntry.id, { enabled: false });
      }
      return lorebookService.getBook(created.id)!;
    });

    return { lorebook, warnings: parsed.warnings };
  });

  ipcMain.handle('lorebooks:clone', (_, id: string) => {
    const source = lorebookService.getBook(id);
    if (!source) throw new Error(`Lorebook with id ${id} not found`);

    const clonedImagePath = source.image ? cloneCharacterImage(source.image) : null;
    return lorebookService.cloneBook(id, clonedImagePath);
  });

  // A character's personal book is created on demand rather than alongside every character,
  // so characters that never need one don't accumulate empty books.
  ipcMain.handle('lorebooks:getPersonalBook', (_, characterId: string) => {
    const character = characterService.getCharacterById(characterId);
    if (!character) throw new Error(`Character with id ${characterId} not found`);
    return lorebookService.getOrCreatePersonalBook(characterId, character.name);
  });

  // Same, for a persona's own private history.
  ipcMain.handle('lorebooks:getPersonalBookForPersona', (_, personaId: string) => {
    const persona = conversationService.getPersona(personaId);
    if (!persona) throw new Error(`UserPersona with id ${personaId} not found`);
    return lorebookService.getOrCreatePersonalBookForPersona(personaId, persona.name);
  });

  ipcMain.handle('lorebooks:getForCharacter', (_, characterId: string) =>
    lorebookService.getBooksForCharacter(characterId)
  );
  ipcMain.handle('lorebooks:attach', (_, characterId: string, lorebookId: string) => {
    lorebookService.attachBook(characterId, lorebookId);
    return { success: true };
  });
  ipcMain.handle('lorebooks:detach', (_, characterId: string, lorebookId: string) => {
    lorebookService.detachBook(characterId, lorebookId);
    return { success: true };
  });

  // Same, for a persona's own attached world books.
  ipcMain.handle('lorebooks:getForPersona', (_, personaId: string) =>
    lorebookService.getBooksForPersona(personaId)
  );
  ipcMain.handle('lorebooks:attachToPersona', (_, personaId: string, lorebookId: string) => {
    lorebookService.attachBookForPersona(personaId, lorebookId);
    return { success: true };
  });
  ipcMain.handle('lorebooks:detachFromPersona', (_, personaId: string, lorebookId: string) => {
    lorebookService.detachBookForPersona(personaId, lorebookId);
    return { success: true };
  });

  // Entries
  ipcMain.handle('loreEntries:getByBook', (_, lorebookId: string) =>
    lorebookService.listEntries(lorebookId)
  );
  ipcMain.handle('loreEntries:create', (_, input: CreateLorebookEntryInput) => {
    guardLoreEntryCreate(input);
    return lorebookService.createEntry(input);
  });
  ipcMain.handle('loreEntries:update', (_, id: string, input: UpdateLorebookEntryInput) => {
    guardLoreEntryUpdate(input);
    return lorebookService.updateEntry(id, input);
  });
  ipcMain.handle('loreEntries:delete', (_, id: string) => {
    lorebookService.deleteEntry(id);
    return { success: true };
  });

  // Bulk-adds entries to an already-existing book (a character's or persona's personal
  // history) from a hand-authored JSON file. "name"/"description" in the JSON, if present,
  // are ignored -- the book already exists.
  ipcMain.handle('loreEntries:importFromJson', async (_, lorebookId: string) => {
    if (!mainWindow) return null;

    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Import entries from JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const parsed = parseLorebookJson(fs.readFileSync(picked.filePaths[0], 'utf-8'));

    transaction(db!, () => {
      for (const entry of parsed.entries) {
        const newEntry = lorebookService.createEntry({
          lorebookId,
          title: entry.title,
          keys: entry.keys,
          content: entry.content,
          alwaysOn: entry.alwaysOn,
          priority: entry.priority,
        });
        if (!entry.enabled) lorebookService.updateEntry(newEntry.id, { enabled: false });
      }
    });

    return { count: parsed.entries.length, warnings: parsed.warnings };
  });

  // Entry versions -- same operations the character field editor offers.
  ipcMain.handle('loreVersions:getByEntry', (_, entryId: string) =>
    lorebookService.getVersions(entryId)
  );
  ipcMain.handle('loreVersions:create', (_, entryId: string, content: string) => {
    guardLoreText(content);
    return lorebookService.createVersion(entryId, content);
  });
  ipcMain.handle('loreVersions:updateContent', (_, versionId: string, content: string) => {
    guardLoreText(content);
    return lorebookService.updateVersionContent(versionId, content);
  });
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
/**
 * A hidden character/persona can't be selected in Chat's dropdowns while locked (existing
 * list filtering), so this should never actually fire through the UI -- it's a backstop
 * against a stale route/request reaching generation anyway (e.g. the Chat page still mounted
 * on a conversation whose character was hidden and the app locked without navigating away).
 * Throws rather than letting decryptIfHidden's lenient locked-read silently feed ciphertext
 * into the model's prompt.
 */
function assertHiddenContentAccessible(
  characterId: string | null,
  personaId?: string | null,
  scenarioId?: string | null
): void {
  if (securityService.isUnlocked()) return;
  if (characterId && characterService.getCharacterById(characterId)?.isHidden) {
    throw new Error('This character is hidden -- unlock with the PIN before chatting with it.');
  }
  if (personaId && conversationService.getPersona(personaId)?.isHidden) {
    throw new Error('This persona is hidden -- unlock with the PIN before using it.');
  }
  if (scenarioId && scenarioService.getScenario(scenarioId)?.isHidden) {
    throw new Error('This scenario is hidden -- unlock with the PIN before using it.');
  }
}

function registerChatHandlers() {
  ipcMain.handle('chat:send', (event, request: ChatSendRequest & { characterId: string; personaId?: string; model: string }) => {
    guardChatMessage(request.message);
    guardDirections(request.directions);
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
        const conversation = conversationService.getConversation(request.conversationId);
        assertHiddenContentAccessible(request.characterId, request.personaId, conversation?.scenarioId);
        const { message, debug, userMessage } = await chatSessions.generate(
          {
            conversationId: request.conversationId,
            characterId: request.characterId,
            personaId: request.personaId ?? null,
            personaName: persona?.name ?? null,
            personaBackground: persona?.background ?? null,
            userMessage: request.message,
            model: request.model,
            directions: request.directions,
            samplers: request.samplers,
          },
          (text) => send({ streamId, type: 'token', text })
        );
        send({ streamId, type: 'done', message, debug, userMessage });
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

  // Redo: same streaming shape as chat:send, but the terminal event is 'variantDone' so the
  // renderer replaces the pending message in place instead of appending a new one.
  ipcMain.handle('chat:regenerate', (event, request: ChatRegenerateRequest) => {
    const streamId = randomUUID();
    const sender = event.sender;

    const send = (payload: ChatStreamEvent) => {
      if (!sender.isDestroyed()) sender.send('chat:stream', payload);
    };

    void (async () => {
      try {
        const conversation = conversationService.getConversation(request.conversationId);
        assertHiddenContentAccessible(
          conversation?.characterId ?? null,
          conversation?.userPersonaId,
          conversation?.scenarioId
        );
        const { message, debug } = await chatSessions.regenerate(
          request.conversationId,
          (text) => send({ streamId, type: 'token', text }),
          request.samplers,
          request.model
        );
        send({ streamId, type: 'variantDone', message, debug });
      } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
          send({ streamId, type: 'cancelled' });
        } else {
          send({ streamId, type: 'error', message: (error as Error).message });
        }
      }
    })();

    return { streamId };
  });

  // Rewrites the user message behind the pending reply and regenerates that reply against the
  // new text -- same streaming shape as chat:regenerate (terminal 'variantDone'), since this
  // also replaces the pending message's shown content rather than appending a new one.
  ipcMain.handle(
    'chat:editPriorMessage',
    (
      event,
      request: ChatEditPriorMessageRequest & { characterId: string; personaId?: string; model: string }
    ) => {
      guardChatMessage(request.message);
      guardDirections(request.directions);
      const streamId = randomUUID();
      const sender = event.sender;

      const send = (payload: ChatStreamEvent) => {
        if (!sender.isDestroyed()) sender.send('chat:stream', payload);
      };

      const persona = request.personaId ? conversationService.getPersona(request.personaId) : null;

      void (async () => {
        try {
          const conversation = conversationService.getConversation(request.conversationId);
          assertHiddenContentAccessible(request.characterId, request.personaId, conversation?.scenarioId);
          const { message, debug, userMessage } = await chatSessions.editPriorUserMessage(
            {
              conversationId: request.conversationId,
              messageId: request.messageId,
              characterId: request.characterId,
              personaId: request.personaId ?? null,
              personaName: persona?.name ?? null,
              personaBackground: persona?.background ?? null,
              userMessage: request.message,
              model: request.model,
              directions: request.directions,
              samplers: request.samplers,
            },
            (text) => send({ streamId, type: 'token', text })
          );
          send({ streamId, type: 'variantDone', message, debug, userMessage });
        } catch (error) {
          if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
            send({ streamId, type: 'cancelled' });
          } else {
            send({ streamId, type: 'error', message: (error as Error).message });
          }
        }
      })();

      return { streamId };
    }
  );

  // Lets the character take another turn on its own -- same streaming shape as chat:send, and
  // the same terminal 'done' event, since this appends a brand-new message rather than
  // replacing the pending one in place (that's what chat:regenerate's 'variantDone' is for).
  ipcMain.handle(
    'chat:continue',
    (event, request: { conversationId: string; characterId: string; personaId?: string; model: string; directions?: string; samplers?: Partial<SamplerParams> }) => {
      guardDirections(request.directions);
      const streamId = randomUUID();
      const sender = event.sender;

      const send = (payload: ChatStreamEvent) => {
        if (!sender.isDestroyed()) sender.send('chat:stream', payload);
      };

      const persona = request.personaId ? conversationService.getPersona(request.personaId) : null;

      void (async () => {
        try {
          const conversation = conversationService.getConversation(request.conversationId);
          assertHiddenContentAccessible(request.characterId, request.personaId, conversation?.scenarioId);
          const { message, debug } = await chatSessions.continueAsCharacter(
            {
              conversationId: request.conversationId,
              characterId: request.characterId,
              personaId: request.personaId ?? null,
              personaName: persona?.name ?? null,
              personaBackground: persona?.background ?? null,
              model: request.model,
              directions: request.directions,
              samplers: request.samplers,
            },
            (text) => send({ streamId, type: 'token', text })
          );
          send({ streamId, type: 'done', message, debug });
        } catch (error) {
          if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
            send({ streamId, type: 'cancelled' });
          } else {
            send({ streamId, type: 'error', message: (error as Error).message });
          }
        }
      })();

      return { streamId };
    }
  );

  ipcMain.handle('chat:getVariants', (_, messageId: string) =>
    conversationService.getVariants(messageId)
  );

  // "View prompt" on a message's hover tooltip -- the logged prompt and prompt pieces for
  // whichever variant of that message is currently selected.
  ipcMain.handle('chat:getMessageDebug', (_, messageId: string) =>
    conversationService.getVariantDebug(messageId)
  );

  // A draft for the composer, not a real turn -- never persisted, never touches the model
  // context. See ChatSessionManager.suggestReply.
  ipcMain.handle(
    'chat:suggestReply',
    async (
      _,
      request: { conversationId: string; characterId: string; personaId?: string; model: string }
    ) => {
      const conversation = conversationService.getConversation(request.conversationId);
      assertHiddenContentAccessible(request.characterId, request.personaId, conversation?.scenarioId);
      const persona = request.personaId ? conversationService.getPersona(request.personaId) : null;
      const suggestion = await chatSessions.suggestReply(
        request.conversationId,
        request.characterId,
        request.personaId ?? null,
        persona?.name ?? null,
        persona?.background ?? null,
        request.model
      );
      return { suggestion };
    }
  );

  ipcMain.handle(
    'chat:selectVariant',
    (_, conversationId: string, messageId: string, variantId: string) =>
      chatSessions.chooseVariant(conversationId, messageId, variantId)
  );

  // Hand-edits the last (pending) assistant message -- see ChatSessionManager.editMessage for
  // why this creates a new variant rather than mutating the shown one in place.
  ipcMain.handle('chat:editMessage', (_, conversationId: string, messageId: string, content: string) => {
    guardChatMessage(content);
    return chatSessions.editMessage(conversationId, messageId, content);
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
  ipcMain.handle('memories:add', (_, conversationId: string, content: string) => {
    guardMemory(content);
    return conversationService.addMemory({ conversationId, content, source: 'manual' });
  });

  ipcMain.handle('memories:update', (_, id: string, content: string) => {
    guardMemory(content);
    return conversationService.updateMemory(id, content);
  });

  ipcMain.handle('memories:delete', (_, id: string) => {
    conversationService.deleteMemory(id);
    return { success: true };
  });

  ipcMain.handle('memories:deleteAll', (_, conversationId: string) => {
    conversationService.deleteAllMemories(conversationId);
    return { success: true };
  });

  ipcMain.handle('chat:deleteMessage', (_, conversationId: string, messageId: string) => {
    chatSessions.deleteMessage(conversationId, messageId);
    return { success: true };
  });

  ipcMain.handle('chat:cancel', (_, conversationId: string) => ({
    cancelled: chatSessions.cancel(conversationId),
  }));

  ipcMain.handle('chat:isGenerating', (_, conversationId: string) =>
    chatSessions.isGenerating(conversationId)
  );
}
