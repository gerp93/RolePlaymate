import { app, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

function getImagesDir(): string {
  return path.join(app.getPath('userData'), 'images');
}

/** Opens a native file picker for a portrait image, copies the chosen file into userData
 * (so it survives independent of wherever the user originally had it), and returns the new
 * absolute path. Returns null if the user cancels. */
export async function chooseCharacterImage(window: BrowserWindow | null): Promise<string | null> {
  if (!window) return null;

  const result = await dialog.showOpenDialog(window, {
    title: 'Choose a character portrait',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ALLOWED_EXTENSIONS }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const sourcePath = result.filePaths[0];
  const ext = path.extname(sourcePath).toLowerCase().replace('.', '') || 'png';
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported image type: .${ext}`);
  }

  const imagesDir = getImagesDir();
  fs.mkdirSync(imagesDir, { recursive: true });

  const destPath = path.join(imagesDir, `${uuidv4()}.${ext}`);
  fs.copyFileSync(sourcePath, destPath);

  return destPath;
}

/** Best-effort cleanup when a character is deleted or its image is replaced -- an orphaned
 * file left behind isn't a correctness problem, just wasted disk space, so failures here are
 * swallowed rather than surfaced to the user. */
export function deleteCharacterImage(imagePath: string | null): void {
  if (!imagePath) return;
  if (!imagePath.startsWith(getImagesDir())) return;
  try {
    fs.unlinkSync(imagePath);
  } catch {
    // already gone, or in use -- not worth failing the caller over
  }
}
