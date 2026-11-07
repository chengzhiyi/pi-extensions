// Boot entry. It must stay free of top-level-await dependencies: the host posts its one-shot
// `pi:hosted:connect` on the iframe's load event, and `load` does NOT wait for async module
// evaluation. The editor graph has TLA (Yoga's WASM init in the layout chunk), so the handshake
// listener is registered here first and the editor is imported dynamically afterwards.
import { hosted, mounted, connectHost } from './host.js';

globalThis.__pencil = { errors: [], ready: false, bootStart: performance.now() };
addEventListener('error', (e) => globalThis.__pencil.errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => globalThis.__pencil.errors.push(String(e.reason?.stack ?? e.reason)));
connectHost();

const loadEditor = () => import('./app.js').catch((error) => {
  globalThis.__pencil.errors.push(String(error?.stack ?? error));
  document.getElementById('app').textContent = `pi-pencil failed to load: ${error?.message ?? error}`;
});
// The hidden controller mount has no UI: it never loads CanvasKit, Yoga or fonts.
if (!hosted) void loadEditor();
else void mounted.then((mount) => { if (mount.kind !== 'controller') return loadEditor(); });
