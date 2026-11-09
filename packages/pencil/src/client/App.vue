<script setup>
// OpenPencil editor frame: OpenPencil's editing UI (menu bar, pages, layers, floating toolbar,
// design panel) built from the headless SDK, plus the agent tab. In the hosted frame the backend is
// authoritative and this editor is a replica that syncs snapshots of human edits. Agent changes
// arrive as new revisions and show on the canvas at once, with an undo for the latest one.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { createDefaultEditorState, createEditor } from '@open-pencil/core';
import { FigmaAPI } from '@open-pencil/core/figma-api';
import { computeAllLayouts } from '@open-pencil/core/layout';
import { SceneGraph } from '@open-pencil/scene-graph';
import { parseColor } from '@open-pencil/scene-graph/color';
import { CanvasRoot, CanvasSurface } from '@open-pencil/vue/canvas';
import { provideEditor } from '@open-pencil/vue';
import CanvasInput from './CanvasInput.vue';
import LeftPanel from './editor/LeftPanel.vue';
import RightPanel from './editor/RightPanel.vue';
import Toolbar from './editor/Toolbar.vue';
import PlayLayer from './editor/PlayLayer.vue';
import { appearance } from './editor/appearance.js';
import { t } from './editor/l10n.js';
import { Layers, PanelRight, Sparkles, Undo2, X } from 'lucide-vue-next';
import { formatShortcut } from '@open-pencil/vue/editor/commands';
import { buildLoginScreen, layoutSnapshot, loadFixtureFonts } from '../adapter/fixture.js';
import { hosted, host, mounted, lifecycle, action, hostCall, notify, reportStatus } from './host.js';
import { loadFig, exportFig, toB64, isImportable, IMPORT_ACCEPT, MAX_IMPORT_BYTES } from './doc.js';

const canvasHost = ref(null);
const graph = new SceneGraph();
const page = graph.getPages()[0];
const editor = createEditor({
  graph,
  state: reactive(createDefaultEditorState(page.id)),
  getViewportSize: () => ({ width: canvasHost.value?.clientWidth ?? 1200, height: canvasHost.value?.clientHeight ?? 800 }),
});
provideEditor(editor);
const p = globalThis.__pencil;
p.editor = editor;
const ui = reactive({ status: 'booting…', docId: null, title: '', rev: null, proposals: [], changes: [], toast: null, message: '', conflicts: [], docs: [], working: false });
// Preview runs on the canvas itself (OpenPencil's play view), so it shares the editor's theme.
const playing = computed(() => editor.state.canvasView?.id === 'play');
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
// Rulers follow the light/dark theme, as OpenPencil's app does (src/app/shell/theme.ts).
function applyRulerTheme() {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => parseColor(style.getPropertyValue(name).trim());
  editor.state.rulerTheme = { background: read('--color-ruler-bg'), tick: read('--color-ruler-tick'), text: read('--color-ruler-text') };
  editor.requestRender?.();
}
applyRulerTheme();
watch(() => appearance.theme, () => requestAnimationFrame(applyRulerTheme));
// Responsive panels: a host sidebar is often ~600 px wide, so the canvas keeps at least half.
// The panels mount once the canvas has its WebGL context: creating the first context while the
// browser composites a full editor UI stalls the main thread for ~0.7 s (measured on Metal).
const chrome = ref(false);
const shellEl = ref(null), shellWidth = ref(1280), leftOpen = ref(false), rightOpen = ref(false);
let resizeObserver = null;
const layout = computed(() => {
  const w = shellWidth.value;
  if (playing.value) return { left: 'closed', right: 'closed', vars: { '--left-w': '0px', '--right-w': '0px' } }; // the preview gets the whole pane
  if (w >= 1200) return { left: 'docked', right: 'docked', vars: { '--left-w': '240px', '--right-w': '300px' } };
  if (w >= 900) return { left: 'docked', right: 'docked', vars: { '--left-w': '208px', '--right-w': '264px' } };
  if (w >= 560) return { left: leftOpen.value ? 'drawer' : 'closed', right: 'docked', vars: { '--left-w': '0px', '--right-w': '240px' } };
  return { left: leftOpen.value ? 'drawer' : 'closed', right: rightOpen.value ? 'drawer' : 'closed', vars: { '--left-w': '0px', '--right-w': '0px' } };
});
const showStatus = computed(() => ui.status !== 'ready' && !/^ready/.test(ui.status));

// ---------- standalone fixture mode (spike S1 CSP harness) ----------
async function seedFixture() {
  try {
    const figma = new FigmaAPI(editor.graph);
    if (editor.renderer) figma.setRenderer(editor.renderer);
    await loadFixtureFonts(figma);
    const screen = buildLoginScreen(figma);
    computeAllLayouts(editor.graph);
    editor.zoomToFit?.(); editor.requestRender?.();
    p.screenId = screen.id; p.layout = layoutSnapshot(editor.graph, screen.id);
    p.firstPaintMs = Math.round(performance.now() - p.bootStart);
    p.exportPng = async (scale = 2) => {
      const [{ getCanvasKit }, raster] = await Promise.all([import('@open-pencil/core/canvaskit'), import('@open-pencil/core/io/formats/raster')]);
      const ck = await getCanvasKit(); const r = editor.renderer;
      await r.prepareForExport?.(editor.graph, page.id, [screen.id]);
      const bytes = await raster.renderNodesToImage(ck, r, editor.graph, page.id, [screen.id], { scale, format: 'PNG' });
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    await frames(); p.ready = true; ui.status = `ready · ${p.firstPaintMs} ms`;
  } catch (error) { p.errors.push(String(error?.stack ?? error)); ui.status = `error: ${error}`; }
}

// ---------- hosted mode: backend is authoritative, this editor is a replica ----------
let suppress = 0, offEvents = null, dirtyTimer = 0, syncing = null, pollTimer = 0, selectionTimer = 0;
function bindEdits(g) {
  offEvents?.();
  const mark = () => {
    if (suppress) return;
    ui.toast = null; // the person edited after the agent: its change is no longer the one to undo
    host.dirty = true; reportStatus();
    clearTimeout(dirtyTimer); dirtyTimer = setTimeout(() => void flush(), 800);
  };
  offEvents = g.onNodeEvents({ created: mark, updated: mark, deleted: mark, reparented: mark, reordered: mark });
}
async function applyDoc(got, { announce = false } = {}) {
  suppress++;
  try {
    // A new revision made by the agent (seen while polling) is shown where it happened: its frames
    // are selected and brought into view, and a toast offers to undo it.
    const latest = got.changes?.[0];
    const fresh = announce && latest && latest.rev === got.rev && latest.undoable && got.docId === ui.docId && got.rev > (ui.rev ?? 0);
    if (got.fig) {
      const g = await loadFig(got.fig);
      editor.replaceGraph(g); bindEdits(g);
      const shown = fresh ? latest.nodeIds.filter((id) => g.getNode(id)) : [];
      if (shown.length) { editor.select?.(shown); editor.zoomToSelection?.(); } else editor.zoomToFit?.();
      editor.requestRender?.();
      await frames(); // let text measurement / derived layout settle before tracking edits
    }
    ui.docId = got.docId; ui.title = got.title ?? ui.title; ui.rev = got.rev;
    ui.proposals = (got.proposals ?? []).filter((x) => x.status === 'pending');
    if (got.changes) ui.changes = got.changes;
    if (fresh) ui.toast = { rev: latest.rev, title: latest.title };
    else if (ui.toast && ui.toast.rev !== got.rev) ui.toast = null;
    host.dirty = false; reportStatus();
  } finally { suppress--; }
}
async function openDoc(docId) { await applyDoc(await action('get', { docId })); }
async function flush() {
  if (syncing) return syncing;
  if (!host.dirty) return;
  syncing = (async () => {
    host.busy = true; reportStatus();
    try {
      clearTimeout(dirtyTimer);
      const fig = await exportFig(editor.graph);
      if (!ui.docId) {
        // The first edits in an empty workspace start a design of their own (rev 1).
        const r = await action('create', { title: t('未命名', 'Untitled'), fig });
        ui.docId = r.docId; ui.title = r.title; ui.rev = r.rev; host.dirty = false; ui.status = 'ready';
        ui.message = t('已创建设计“' + r.title + '”', `Started design “${r.title}”`);
        ui.docs = await action('list', {});
        return;
      }
      const r = await action('sync', { docId: ui.docId, baseRev: ui.rev, fig });
      ui.rev = r.rev; host.dirty = false; ui.message = `Your edits are saved as rev ${r.rev}`;
    } catch (e) {
      ui.message = e.reason === 'stale_base' ? 'The design changed elsewhere; reloading (your unsynced edit was not applied).' : `Sync failed: ${e.message}`;
      if (e.reason === 'stale_base') { host.dirty = false; await openDoc(ui.docId); }
    } finally { host.busy = false; syncing = null; reportStatus(); }
  })();
  return syncing;
}
async function poll() {
  if (host.frozen || host.dirty || host.busy || ui.working) return;
  try {
    if (!ui.docId) { // empty workspace: pick up the first design the agent proposes
      const docs = await action('list', {});
      ui.docs = docs;
      if (docs.length && !ui.docId && !host.dirty) {
        const got = await action('get', { docId: docs.at(-1).docId });
        ui.docId = got.docId; // the agent's first design is announced like any later change
        await applyDoc(got, { announce: true }); ui.status = 'ready';
      }
      return;
    }
    const got = await action('get', { docId: ui.docId, sinceRev: ui.rev });
    if (got.unchanged) ui.proposals = got.proposals.filter((x) => x.status === 'pending'); else await applyDoc(got, { announce: true });
  } catch (e) { ui.message = `Refresh failed: ${e.message}`; }
}
async function run(label, fn) {
  if (host.frozen) { ui.message = t('OpenPencil 正在更新，请稍后再试。', 'OpenPencil is updating; try again in a moment.'); return; }
  ui.working = true; ui.message = ''; ui.conflicts = [];
  try { await flush(); await fn(); }
  catch (e) { ui.message = `${label} failed: ${e.message}`; ui.conflicts = e.conflicts ?? []; void notify(ui.message, 'error'); }
  finally { ui.working = false; }
}
const decide = (proposal, verdict) => run(verdict === 'accept' ? 'Accept' : 'Reject', async () => {
  const r = await action(verdict, { docId: ui.docId, proposalId: proposal.id });
  ui.message = verdict === 'accept' ? `Applied “${proposal.title}” as rev ${r.rev}${r.rebased ? ' (rebased onto your edits)' : ''}` : `Rejected “${proposal.title}”`;
  await openDoc(ui.docId);
});
// Undo the agent's latest change (only while nothing happened after it; the backend checks).
const undoAgent = () => run(t('撤销', 'Undo'), async () => {
  const r = await action('revert', { docId: ui.docId, rev: ui.rev });
  ui.toast = null;
  await openDoc(ui.docId);
  ui.message = t(`已撤销 Agent 的修改“${r.title}”`, `Undid the agent's change “${r.title}”`);
});
const selected = () => [...(editor.state.selectedIds ?? [])];
const lock = (locked) => run(locked ? 'Lock' : 'Unlock', async () => {
  const ids = selected(); if (!ids.length) throw new Error('select layers first');
  await action('lock', { docId: ui.docId, nodeIds: ids, locked });
  ui.message = `${locked ? 'Locked' : 'Unlocked'} ${ids.length} layer(s) for the agent`;
  await openDoc(ui.docId);
});
const scope = () => run('Scope', async () => {
  const ids = selected(); if (!ids.length) throw new Error('select layers first');
  await action('selection', { docId: ui.docId, nodeIds: ids, task: true });
  ui.message = `The agent may now change only the ${ids.length} selected layer(s) and their contents`;
});
const unscope = () => run('Scope', async () => {
  await action('selection', { docId: ui.docId, nodeIds: selected(), clearTask: true });
  ui.message = t('Agent 可以再次修改整个设计', 'The agent may change the whole design again');
});
// Workspace → its own editor tab (panel alias `pencil:<docId>`), opened by the host workbench.
const openTab = () => run('Open', () => hostCall('openPanel', { kind: 'editor', contentId: ui.docId, title: ui.title || 'OpenPencil' }));
const save = () => run('Save', async () => { const r = await action('save', { docId: ui.docId }); ui.message = `Saved ${r.path} (${Math.round(r.bytes / 1024)} KB)`; });
const refreshDocs = async () => { ui.docs = await action('list', {}); };
const newDesign = () => run('New design', async () => {
  const r = await action('create', { title: t('未命名', 'Untitled') });
  await openDoc(r.docId); await refreshDocs(); ui.status = 'ready';
  ui.message = t('已创建设计“' + r.title + '”', `Started design “${r.title}”`);
});
const switchDesign = (docId) => docId !== ui.docId && run('Open', async () => { await openDoc(docId); await refreshDocs(); ui.status = 'ready'; });
const renameDesign = (title) => run('Rename', async () => { const r = await action('rename', { docId: ui.docId, title }); ui.title = r.title; await refreshDocs(); });
// ---------- open ----------
// File → Open… (⌘O) or dropping a file onto the editor: a Figma, FigJam, Pencil or draw.io file from
// the person's computer becomes a new design on the canvas; Save writes it as a .fig under designs/.
// Place image: PNG/JPG/WebP/GIF/SVG onto the current page.
const fileInput = ref(null), imageInput = ref(null), dropping = ref(false);
const pickDocument = () => { if (!ui.working && !host.frozen) fileInput.value?.click(); };
const pickImage = () => imageInput.value?.click();
// ⌘O / Ctrl+O, as in OpenPencil (the key press is the user gesture the file picker needs).
function onOpenKey(e) {
  if (!hosted || e.code !== 'KeyO' || !(/Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (playing.value || editor.state.editingTextId) return;
  e.preventDefault(); pickDocument();
}
async function importFile(file) {
  if (!isImportable(file)) throw new Error(t(`不支持的文件类型：${file.name}（可打开 ${IMPORT_ACCEPT}）`, `${file.name} is not a supported file (open ${IMPORT_ACCEPT})`));
  if (file.size > MAX_IMPORT_BYTES) throw new Error(t(`${file.name} 超过 32 MB`, `${file.name} is larger than 32 MB`));
  const r = await action('import', { name: file.name, data: toB64(new Uint8Array(await file.arrayBuffer())) }).catch((e) => {
    // A pi-webapp from before Open existed has not reviewed these actions: say what to do instead of a 403.
    if (e?.code === 'action_denied' || e?.errorCode === 'action_denied' || /not reviewed/i.test(e?.message ?? '')) throw new Error(t('当前 pi-webapp 版本还不支持打开文件，请更新 pi-webapp 后重试。', 'This pi-webapp version cannot open files yet; update pi-webapp and try again.'));
    throw e;
  });
  await openDoc(r.docId);
  return r;
}
const importFiles = (files) => run(t('打开', 'Open'), async () => {
  const list = [...files]; if (!list.length) return;
  let last = null;
  for (const file of list) last = await importFile(file);
  await refreshDocs(); ui.status = 'ready';
  ui.message = list.length === 1 ? t(`已打开“${last.title}”`, `Opened “${last.title}”`) : t(`已打开 ${list.length} 个文件`, `Opened ${list.length} files`);
  void notify(ui.message);
});
function placeImages(files) {
  const list = [...files]; if (!list.length) return;
  const w = canvasHost.value?.clientWidth ?? 1200, h = canvasHost.value?.clientHeight ?? 800;
  const at = editor.screenToCanvas?.(w / 2, h / 2) ?? { x: 0, y: 0 };
  editor.placeFiles(list, at.x, at.y).catch((e) => { ui.message = t(`放置图片失败：${e.message}`, `Could not place the image: ${e.message}`); });
}
const onPicked = (e, handler) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) handler(files); };
// Document files dropped anywhere on the editor are imported; images and SVG go on to the canvas,
// whose own drop handler places them (it ignores every other file type).
const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
let dropTimer = 0;
function onDragOver(e) {
  if (!hosted || !hasFiles(e) || host.frozen) return;
  // File names are hidden until drop; anything that is not an image may be a document.
  const doc = [...(e.dataTransfer.items ?? [])].some((i) => i.kind === 'file' && !/^image\//.test(i.type));
  if (doc) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  dropping.value = doc;
  clearTimeout(dropTimer); dropTimer = setTimeout(() => { dropping.value = false; }, 200); // dragover repeats while over the frame
}
function onDrop(e) {
  dropping.value = false;
  if (!hosted || !hasFiles(e)) return;
  const docs = [...(e.dataTransfer.files ?? [])].filter(isImportable);
  if (!docs.length) return;
  e.preventDefault(); e.stopPropagation();
  void importFiles(docs);
}

const fileItems = computed(() => hosted ? [
  { label: t('新建设计', 'New design'), action: newDesign, disabled: ui.working },
  { label: t('打开…', 'Open…'), shortcut: formatShortcut('MOD+O'), action: pickDocument, disabled: ui.working, testId: 'file-open' },
  { label: t('放置图片…', 'Place image…'), action: pickImage, disabled: ui.working || playing.value, testId: 'file-place-image' },
  { separator: true },
  { label: t('保存为 .fig', 'Save as .fig'), shortcut: '', action: save, disabled: ui.working || !ui.docId },
  ...(host.mount?.kind === 'workspace' ? [{ label: t('在新标签页中打开', 'Open in tab'), action: openTab, disabled: ui.working || !ui.docId }] : []),
] : []);

async function bootHosted() {
  ui.status = 'connecting…';
  const mount = await Promise.race([mounted, new Promise((_, reject) => setTimeout(() => reject(new Error('host handshake did not arrive within 15 s')), 15_000))]);
  ui.status = `loading designs… (${mount.kind})`;
  ui.docs = await action('list', {});
  // Only an editor mount names a design (its panel alias `pencil:<docId>`); the workspace entry's
  // contentId is the workbench's own panel id, so the workspace shows the latest design.
  const wanted = mount.kind === 'editor' ? mount.contentId : null;
  const docId = wanted && ui.docs.some((d) => d.docId === wanted) ? wanted : ui.docs.at(-1)?.docId;
  if (docId) await openDoc(docId);
  if (!docId) bindEdits(editor.graph); // the first human edit creates a design (see flush)
  ui.status = wanted && docId !== wanted ? `Design ${wanted} no longer exists${docId ? '; showing the latest one' : ''}.`
    : docId ? 'ready' : t('还没有设计：直接在画布上绘制，或让 Agent 设计。', 'No design yet: draw on the canvas, or ask the agent to design something.');
  startPolling();
  watch(() => [...(editor.state.selectedIds ?? [])].join(','), (ids) => {
    clearTimeout(selectionTimer);
    if (ui.docId && !host.frozen) selectionTimer = setTimeout(() => void action('selection', { docId: ui.docId, nodeIds: ids ? ids.split(',') : [] }).catch(() => {}), 400);
  });
  p.ready = true; p.ui = ui; p.flush = flush; p.poll = poll;
}
p.flush = flush;
const startPolling = () => { clearInterval(pollTimer); pollTimer = setInterval(() => void poll(), 1500); };
const stopIo = () => { clearInterval(pollTimer); clearTimeout(dirtyTimer); clearTimeout(selectionTimer); };
// Host view lifecycle (host.js answers the RPCs; these only stop/resume this editor's own I/O).
// freeze runs after a successful flush; while frozen the shell is inert, so no edit can start.
Object.assign(lifecycle, {
  flush,
  freeze: async () => { stopIo(); await syncing; },
  restore: async () => { startPolling(); await poll(); },
  dispose: async () => { stopIo(); offEvents?.(); },
});

onMounted(() => {
  addEventListener('keydown', onOpenKey);
  resizeObserver = new ResizeObserver(([entry]) => { shellWidth.value = entry.contentRect.width; });
  if (shellEl.value) resizeObserver.observe(shellEl.value);
  const wait = setInterval(() => { if (editor.renderer) { clearInterval(wait); chrome.value = true; void (hosted ? bootHosted().catch((e) => { p.errors.push(String(e?.stack ?? e)); ui.status = `error: ${e?.reason ?? e?.code ?? ''} ${e?.message ?? e}`; }) : seedFixture()); } }, 16);
});
onUnmounted(() => { removeEventListener('keydown', onOpenKey); resizeObserver?.disconnect(); stopIo(); offEvents?.(); });
</script>

<template>
  <div ref="shellEl" class="shell op-shell" @dragover.capture="onDragOver" @drop.capture="onDrop" :class="{ hosted }" :style="layout.vars" :data-left="layout.left" :data-right="layout.right" :inert="host.frozen" :data-frozen="host.frozen || undefined" :data-playing="playing || undefined">
    <LeftPanel v-if="chrome" v-show="!playing" :ui="ui" :hosted="hosted" :file-items="fileItems" @new="newDesign" @switch="switchDesign" @rename="renameDesign" />
    <main class="op-center">
      <div ref="canvasHost" class="canvas">
        <CanvasRoot :show-rulers="!playing">
          <CanvasSurface style="width: 100%; height: 100%" />
          <CanvasInput />
          <PlayLayer v-if="chrome" />
        </CanvasRoot>
      </div>
      <span data-testid="status" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">{{ ui.status }}</span>
      <div v-if="showStatus" class="op-status" :data-error="/^error/.test(ui.status) || undefined">{{ ui.status }}</div>
      <div v-if="layout.left !== 'docked' && !playing" class="op-panel-toggles left">
        <button type="button" class="icon-btn" data-testid="toggle-left" :data-active="leftOpen || undefined" :title="t('页面与图层', 'Pages and layers')" @click="leftOpen = !leftOpen"><Layers /></button>
      </div>
      <div v-if="layout.right !== 'docked' && !playing" class="op-panel-toggles right">
        <button type="button" class="icon-btn" data-testid="toggle-right" :data-active="rightOpen || undefined" :title="t('设计面板', 'Design panel')" @click="rightOpen = !rightOpen"><PanelRight /></button>
      </div>
      <div v-if="ui.toast && !playing" class="op-agent-toast" role="status" data-testid="agent-toast">
        <Sparkles />
        <span class="truncate">{{ t('Agent 已修改：', 'Agent changed: ') }}<b>{{ ui.toast.title }}</b></span>
        <button type="button" class="btn" data-testid="agent-undo" :disabled="ui.working" @click="undoAgent"><Undo2 />{{ t('撤销', 'Undo') }}</button>
        <button type="button" class="icon-btn" :aria-label="t('关闭', 'Dismiss')" @click="ui.toast = null"><X /></button>
      </div>
      <Toolbar v-if="chrome && !playing" />
      <div v-if="dropping" class="op-drop-hint">{{ t('松开以打开文件', 'Drop to open the file') }}</div>
    </main>
    <template v-if="hosted">
      <input ref="fileInput" type="file" hidden multiple :accept="IMPORT_ACCEPT" data-testid="import-input" @change="onPicked($event, importFiles)" />
      <input ref="imageInput" type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" data-testid="image-input" @change="onPicked($event, placeImages)" />
    </template>
    <RightPanel v-if="chrome" v-show="!playing" :ui="ui" :hosted="hosted" :can-open-tab="host.mount?.kind === 'workspace'"
      @decide="decide" @lock="lock" @scope="scope" @unscope="unscope" @save="save" @open-tab="openTab" @undo="undoAgent" @present="editor.startPlay()" />
  </div>
</template>
