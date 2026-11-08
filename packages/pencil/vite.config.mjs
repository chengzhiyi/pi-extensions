import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';
const pnpmDir = fileURLToPath(new URL('../../node_modules/.pnpm/', import.meta.url));
const cssomDir = readdirSync(pnpmDir).filter((d) => d.startsWith('@acemir+cssom@')).sort().at(-1);
const cssomLib = join(pnpmDir, cssomDir, 'node_modules/@acemir/cssom/lib/index.js');
// The SDK reads CanvasRoot's showRulers once, at mount, and its ruler drawing never consults the play
// view, so OpenPencil's preview kept the editing rulers. Skip them while the canvas plays. Exact-source
// match: an upstream change fails the build instead of silently dropping the patch.
const RULERS_NEEDLE = 'shouldShowRulers(), options?.layer ?? "full"';
const playHidesRulers = {
  name: 'pencil-play-hides-rulers', enforce: 'pre',
  transform(code, id) {
    if (!/@open-pencil[\\/]vue[\\/]dist[\\/]canvas[\\/]surface[\\/]lifecycle\.js$/.test(id)) return null;
    if (code.split(RULERS_NEEDLE).length !== 2) this.error('@open-pencil/vue canvas/surface/lifecycle.js changed: re-check the play-hides-rulers patch');
    return { code: code.replace(RULERS_NEEDLE, 'shouldShowRulers() && view.canvasView?.id !== "play", options?.layer ?? "full"'), map: null };
  },
};
// Frame build. assetsInlineLimit 0: never inline WASM/fonts as data: URLs (CSP connect-src 'self').
export default defineConfig({
  root: fileURLToPath(new URL('./src/client/', import.meta.url)),
  base: './',
  plugins: [playHidesRulers, vue()],
  resolve: {
    alias: [
      // cssom's package.json "browser" points at a browserified bundle without ESM named exports.
      { find: /^@acemir\/cssom$/, replacement: cssomLib },
      { find: /^elkjs(\/.*)?$/, replacement: fileURLToPath(new URL('./src/client/stubs/elkjs.js', import.meta.url)) },
      { find: /^undici$/, replacement: fileURLToPath(new URL('./src/client/stubs/undici.js', import.meta.url)) },
    ],
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: fileURLToPath(new URL('./dist/', import.meta.url)), emptyOutDir: false, assetsInlineLimit: 0,
    target: 'es2022', modulePreload: { polyfill: false }, reportCompressedSize: true,
    rollupOptions: {
      input: { frame: fileURLToPath(new URL('./src/client/frame.html', import.meta.url)) },
      // WASM and fonts keep stable names: the backend reads the same files (no duplicate copies).
      // Host asset URLs already carry the package digest, so caching stays correct.
      output: { assetFileNames: (info) => /\.(wasm|ttf|otf|woff2?)$/.test(info.names?.[0] ?? info.name ?? '') ? 'assets/[name][extname]' : 'assets/[name]-[hash][extname]' },
    },
  },
  worker: { format: 'es' },
});
