// Hosted-v2 frame handshake (ported from pi-excalidraw frame.tsx): exact parent origin, source
// window, plugin id, generation and mount id; exactly one MessagePort. The editor registers its
// lifecycle hooks in `lifecycle`; status reports are serialized so the host's freeze barrier never
// sees a stale busy/dirty report arrive after this frame acknowledged the freeze.
import { reactive } from 'vue';

const expected = new URL(location.href).searchParams;
export const hosted = !!expected.get('parentOrigin');
export const host = reactive({ connected: false, mount: null, dirty: false, busy: false, frozen: false });
/** Set by the editor: flush() syncs edits; freeze()/restore() stop and resume its own I/O; dispose() tears down. */
export const lifecycle = {};
let port = null, seq = 0;
// MessagePort uses structured clone, which rejects Vue reactive proxies: send plain JSON data only.
const plain = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const pending = new Map();
let resolveMount; export const mounted = new Promise((r) => { resolveMount = r; });

/** `raw` sends `input` as is (a Blob, for downloads); everything else goes as plain JSON. */
export function hostCall(method, input, raw = false) {
  if (!port) return Promise.reject(new Error('Host port unavailable'));
  return new Promise((resolve, reject) => {
    const id = `pencil-${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Host ${method} timed out`)); }, 130_000);
    pending.set(id, { resolve, reject, timer });
    try { port.postMessage({ type: 'request', id, method, input: raw ? input : plain(input) }); } catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}
export const action = (name, input = {}) => hostCall('action', { action: name, input });
let statusChain = Promise.resolve(), reported = '';
/** Serialized and de-duplicated; resolves once the host has recorded this frame's current status. */
export function reportStatus() {
  if (!port) return statusChain;
  statusChain = statusChain.then(() => {
    const status = { dirty: host.dirty, busy: host.busy }, text = JSON.stringify(status);
    if (text === reported) return;
    return hostCall('changed', status).then(() => { reported = text; });
  }).catch(() => {});
  return statusChain;
}

export function connectHost() {
  if (!hosted) return;
  addEventListener('message', function handshake(event) {
    const d = event.data;
    if (event.source !== parent || event.origin !== expected.get('parentOrigin') || d?.type !== 'pi:hosted:connect' || d.protocol !== 1
      || d.pluginId !== expected.get('pluginId') || String(d.generation) !== expected.get('generation') || d.mountId !== expected.get('mountId') || event.ports.length !== 1) return;
    removeEventListener('message', handshake);
    port = event.ports[0];
    port.onmessage = async ({ data }) => {
      if (data?.type === 'response') {
        const w = pending.get(data.id); if (!w) return;
        pending.delete(data.id); clearTimeout(w.timer);
        if (data.ok) w.resolve(data.value); else w.reject(Object.assign(new Error(data.error?.message ?? 'Host call failed'), data.error ?? {}));
        return;
      }
      if (data?.type !== 'request') return;
      try { port.postMessage({ type: 'response', id: data.id, ok: true, value: plain(await handle(data.method, data.input)) }); }
      catch (e) { port.postMessage({ type: 'response', id: data.id, ok: false, error: { code: 'frame_error', message: String(e?.message ?? e) } }); }
    };
    port.start();
    host.connected = true;
  });
}
const contribution = {
  entry: { label: 'Pencil', description: { zh: 'UI 设计', en: 'UI design' }, kind: 'workspace' },
  panels: ['workspace', 'editor'], artifactTools: ['pencil_propose_changes'], toolViews: [], panelAlias: { prefix: 'pencil:', kind: 'editor', title: 'Pencil' },
};
const KINDS = ['controller', 'workspace', 'editor', 'tool'];
async function flush() {
  await lifecycle.flush?.();
  if (host.dirty || host.busy) throw new Error('Pencil edits are still syncing; try again');
  await reportStatus();
  return { dirty: false, busy: false };
}
let disposed = false;
async function handle(method, input) {
  if (disposed) throw new Error('Disposed');
  switch (method) {
    case 'describe': return contribution;
    case 'initialize':
      if (host.mount) throw new Error('Already initialized');
      if (!input || !KINDS.includes(input.kind) || typeof input.sessionId !== 'string') throw new Error('Invalid mount');
      host.mount = plain(input); resolveMount(host.mount);
      // Finish initialization with a status from this realm: the host registers views as dirty/busy until then.
      await reportStatus();
      return contribution;
    case 'update':
      if (!host.mount) throw new Error('Not initialized');
      if (input?.sessionId && input.sessionId !== host.mount.sessionId) throw new Error('Session cannot change');
      host.mount = { ...host.mount, ...plain(input) }; return null;
    case 'flush': return flush();
    case 'freeze':
      await flush();
      host.frozen = true; await lifecycle.freeze?.();
      if (host.dirty || host.busy) { host.frozen = false; await lifecycle.restore?.(); throw new Error('Pencil changed while freezing'); }
      return { mount: plain(host.mount), undoClearedOnReopen: true };
    case 'restore':
      if (!host.mount || input?.mount?.sessionId !== host.mount.sessionId) throw new Error('Snapshot scope mismatch');
      host.frozen = false; await lifecycle.restore?.();
      return { undoClearedOnReopen: true };
    case 'dispose':
      await flush(); disposed = true; await lifecycle.dispose?.();
      setTimeout(() => port?.close(), 0); return null;
    default: throw new Error('Unknown frame method');
  }
}
