// Hosted-v2 frame handshake (ported from pi-excalidraw frame.tsx): exact parent origin, source
// window, plugin id, generation and mount id; exactly one MessagePort. Spike: no flush coordination
// beyond reporting dirty/busy; edits are synced to the backend continuously.
import { reactive } from 'vue';

const expected = new URL(location.href).searchParams;
export const hosted = !!expected.get('parentOrigin');
export const host = reactive({ connected: false, mount: null, dirty: false, busy: false });
let port = null, seq = 0;
const pending = new Map();
let resolveMount; export const mounted = new Promise((r) => { resolveMount = r; });

export function hostCall(method, input) {
  if (!port) return Promise.reject(new Error('Host port unavailable'));
  return new Promise((resolve, reject) => {
    const id = `pencil-${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Host ${method} timed out`)); }, 130_000);
    pending.set(id, { resolve, reject, timer });
    port.postMessage({ type: 'request', id, method, input });
  });
}
export const action = (name, input = {}) => hostCall('action', { action: name, input });
export function reportStatus() { if (port) void hostCall('changed', { dirty: host.dirty, busy: host.busy }).catch(() => {}); }

export function connectHost(handlers = {}) {
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
      try { port.postMessage({ type: 'response', id: data.id, ok: true, value: await handle(data.method, data.input, handlers) }); }
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
async function handle(method, input, handlers) {
  switch (method) {
    case 'describe': return contribution;
    case 'initialize': host.mount = input; resolveMount(input); reportStatus(); return contribution;
    case 'update': host.mount = { ...host.mount, ...input }; return null;
    case 'flush': await handlers.flush?.(); if (host.dirty || host.busy) throw new Error('Edits are still syncing'); return { dirty: false, busy: false };
    case 'freeze': await handlers.flush?.(); return { mount: host.mount, undoClearedOnReopen: true };
    case 'restore': return { undoClearedOnReopen: true };
    case 'dispose': await handlers.flush?.(); setTimeout(() => port?.close(), 0); return null;
    default: throw new Error('Unknown frame method');
  }
}
