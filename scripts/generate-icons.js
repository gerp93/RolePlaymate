#!/usr/bin/env node
// Generates all app icon/logo assets from the single source mark at
// assets/logo.png. Never hand-export sizes individually — re-run this
// script instead. See KVG_Standards app-standards skill, "Logo & branding".
//
// Inert until a real assets/logo.png exists -- see TODO.md.

const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'logo.png');

async function squareSource() {
  // The master mark has whitespace padding baked in from generation;
  // trim it off and re-pad to a true square so every derived size is
  // centered and consistently proportioned.
  const trimmed = await sharp(SOURCE).trim().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width, meta.height);
  return sharp(trimmed)
    .resize(side, side, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toBuffer();
}

async function main() {
  const square = await squareSource();

  // Packaged binary/installer icon — electron-builder auto-converts a
  // single high-res PNG to .ico/.icns per platform.
  await sharp(square)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(ROOT, 'build', 'icon.png'));

  // In-app window/taskbar icon, set at runtime via BrowserWindow({ icon }).
  await sharp(square)
    .resize(256, 256)
    .png()
    .toFile(path.join(ROOT, 'assets', 'icon.png'));

  // Renderer UI (topbar) + favicon.
  await sharp(square)
    .resize(512, 512)
    .png()
    .toFile(path.join(ROOT, 'public', 'logo.png'));

  console.log('Generated build/icon.png, assets/icon.png, public/logo.png from assets/logo.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
