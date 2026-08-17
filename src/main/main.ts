import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import { initDatabase, saveDatabase } from './database/schema';
import {
  getEffectiveDbPath,
  getDefaultDbPath,
  isUsingDefaultLocation,
  setDbPath,
  resetToDefaultDbPath,
} from './dbLocation';
import { CharacterService } from './database/characterService';
import { CharacterFieldService } from './database/characterFieldService';
import { FieldVersionService } from './database/fieldVersionService';
import { chooseCharacterImage, deleteCharacterImage } from './images';
import { CreateCharacterInput, UpdateCharacterInput } from '../shared/types/character';
import { FIELD_TYPES } from '../shared/types/characterField';
import { Database } from 'sql.js';

// Packaged builds resolve app.getPath('userData') from build.productName ("RolePlaymate"),
// while `electron .` in dev resolves it from package.json's "name" ("roleplaymate") -- pin it
// so both modes always read/write the same data folder instead of silently diverging.
app.setName('roleplaymate');

let mainWindow: BrowserWindow | null = null;
let db: Database | null = null;
let characterService: CharacterService;
let fieldService: CharacterFieldService;
let fieldVersionService: FieldVersionService;

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

app.whenReady().then(async () => {
  db = await initDatabase();
  characterService = new CharacterService(db);
  fieldService = new CharacterFieldService(db);
  fieldVersionService = new FieldVersionService(db);

  registerIPCHandlers();

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (db) {
    saveDatabase(db);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIPCHandlers() {
  // Character handlers
  ipcMain.handle('characters:getAll', () => characterService.getAllCharacters());
  ipcMain.handle('characters:getById', (_, id: string) => characterService.getCharacterById(id));

  // Creating a character also creates its three fixed fields (personality/scenario/greeting),
  // each with a blank first version -- unlike TrackDraft's freely-added Parts, a character's
  // fields are a fixed set, so there's no separate "add field" action.
  ipcMain.handle('characters:create', (_, input: CreateCharacterInput) => {
    const character = characterService.createCharacter(input);
    for (const fieldType of FIELD_TYPES) {
      const field = fieldService.createField(character.id, fieldType);
      fieldVersionService.createVersion({ fieldId: field.id, content: '' });
    }
    return character;
  });

  ipcMain.handle('characters:update', (_, id: string, input: UpdateCharacterInput) =>
    characterService.updateCharacter(id, input)
  );
  ipcMain.handle('characters:delete', (_, id: string) => {
    const existing = characterService.getCharacterById(id);
    characterService.deleteCharacter(id);
    if (existing?.imageUrl) deleteCharacterImage(existing.imageUrl);
    return { success: true };
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

  // Image handlers
  ipcMain.handle('images:choose', async () => {
    return chooseCharacterImage(mainWindow);
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
    if (db) {
      saveDatabase(db);
    }
    setDbPath(newPath);
    app.relaunch();
    app.exit();
    return { success: true };
  });

  ipcMain.handle('dbLocation:resetToDefault', () => {
    if (db) {
      saveDatabase(db);
    }
    resetToDefaultDbPath();
    app.relaunch();
    app.exit();
    return { success: true };
  });

  // App / update handlers
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('updates:check', () => checkForUpdatesNow());
}
