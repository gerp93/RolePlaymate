import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Content-Security-Policy for the built renderer, injected at build time only.
 *
 * Build-only because the dev server needs what a useful CSP forbids: react-refresh evaluates
 * code and Vite's HMR opens a websocket back to localhost. The packaged app is the thing that
 * ships, and there it is a hard backstop -- no remote script or style can load, and no
 * connection can leave the renderer, whatever ends up in the DOM.
 *
 * `style-src` allows inline styles because React writes element `style` props that way, and
 * `img-src`/`media-src` allow the `rpimage:` scheme portraits and spoken audio are served
 * over (see the protocol.handle registration in main.ts), plus the `data:`/`blob:` URLs the
 * TTS playback hooks build for freshly generated clips.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' rpimage: data: blob:",
  "media-src 'self' rpimage: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'roleplaymate-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  build: {
    outDir: 'dist/renderer',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  server: {
    port: 5173,
  },
});
