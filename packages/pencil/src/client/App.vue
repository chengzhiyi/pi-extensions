<script setup>
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { createDefaultEditorState, createEditor } from '@open-pencil/core';
import { FigmaAPI } from '@open-pencil/core/figma-api';
import { computeAllLayouts } from '@open-pencil/core/layout';
import { SceneGraph } from '@open-pencil/scene-graph';
import { CanvasRoot, CanvasSurface } from '@open-pencil/vue/canvas';
import { provideEditor } from '@open-pencil/vue';
import CanvasInput from './CanvasInput.vue';
import { buildLoginScreen, layoutSnapshot, loadFixtureFonts } from '../adapter/fixture.js';
import { hosted, host, mounted, action, reportStatus } from './host.js';
import { loadFig, exportFig } from './doc.js';

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
const ui = reactive({ status: 'booting…', docId: null, title: '', rev: null, proposals: [], message: '', conflicts: [], docs: [], working: false });
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

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
    host.dirty = true; reportStatus();
    clearTimeout(dirtyTimer); dirtyTimer = setTimeout(() => void flush(), 800);
  };
  offEvents = g.onNodeEvents({ created: mark, updated: mark, deleted: mark, reparented: mark, reordered: mark });
}
async function applyDoc(got) {
  suppress++;
  try {
    if (got.fig) {
      const g = await loadFig(got.fig);
      editor.replaceGraph(g); bindEdits(g);
      editor.zoomToFit?.(); editor.requestRender?.();
      await frames(); // let text measurement / derived layout settle before tracking edits
    }
    ui.docId = got.docId; ui.title = got.title ?? ui.title; ui.rev = got.rev;
    ui.proposals = (got.proposals ?? []).filter((x) => x.status === 'pending');
    host.dirty = false; reportStatus();
  } finally { suppress--; }
}
async function openDoc(docId) { await applyDoc(await action('get', { docId })); }
async function flush() {
  if (syncing) return syncing;
  if (!host.dirty || !ui.docId) return;
  syncing = (async () => {
    host.busy = true; reportStatus();
    try {
      clearTimeout(dirtyTimer);
      const fig = await exportFig(editor.graph);
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
  if (!ui.docId || host.dirty || host.busy || ui.working) return;
  try { const got = await action('get', { docId: ui.docId, sinceRev: ui.rev }); if (got.unchanged) ui.proposals = got.proposals.filter((x) => x.status === 'pending'); else await applyDoc(got); }
  catch (e) { ui.message = `Refresh failed: ${e.message}`; }
}
async function run(label, fn) {
  ui.working = true; ui.message = ''; ui.conflicts = [];
  try { await flush(); await fn(); }
  catch (e) { ui.message = `${label} failed: ${e.message}`; ui.conflicts = e.conflicts ?? []; }
  finally { ui.working = false; }
}
const decide = (proposal, verdict) => run(verdict === 'accept' ? 'Accept' : 'Reject', async () => {
  const r = await action(verdict, { docId: ui.docId, proposalId: proposal.id });
  ui.message = verdict === 'accept' ? `Applied “${proposal.title}” as rev ${r.rev}${r.rebased ? ' (rebased onto your edits)' : ''}` : `Rejected “${proposal.title}”`;
  await openDoc(ui.docId);
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
const save = () => run('Save', async () => { const r = await action('save', { docId: ui.docId }); ui.message = `Saved ${r.path} (${Math.round(r.bytes / 1024)} KB)`; });

async function bootHosted() {
  ui.status = 'connecting…';
  const mount = await mounted;
  ui.docs = await action('list', {});
  const docId = mount.contentId || ui.docs.at(-1)?.docId;
  if (docId) await openDoc(docId);
  ui.status = docId ? 'ready' : 'No designs yet: ask the agent to design something.';
  pollTimer = setInterval(() => void poll(), 1500);
  watch(() => [...(editor.state.selectedIds ?? [])].join(','), (ids) => {
    clearTimeout(selectionTimer);
    if (ui.docId) selectionTimer = setTimeout(() => void action('selection', { docId: ui.docId, nodeIds: ids ? ids.split(',') : [] }).catch(() => {}), 400);
  });
  p.ready = true; p.ui = ui; p.flush = flush; p.poll = poll;
}
p.flush = flush;

onMounted(() => {
  const wait = setInterval(() => { if (editor.renderer) { clearInterval(wait); void (hosted ? bootHosted() : seedFixture()); } }, 16);
});
onUnmounted(() => { clearInterval(pollTimer); offEvents?.(); });
</script>

<template>
  <div class="shell" :class="{ hosted }">
    <div class="bar">
      <strong>pi-pencil</strong>
      <span data-testid="status">{{ ui.status }}</span>
      <template v-if="hosted && ui.docId">
        <span class="muted">{{ ui.title }} · rev {{ ui.rev }}{{ host.dirty || host.busy ? ' · syncing…' : '' }}</span>
        <span class="spacer" />
        <button data-testid="scope" :disabled="ui.working" @click="scope">Agent: only selection</button>
        <button data-testid="lock" :disabled="ui.working" @click="lock(true)">Lock</button>
        <button data-testid="unlock" :disabled="ui.working" @click="lock(false)">Unlock</button>
        <button data-testid="save" :disabled="ui.working" @click="save">Save .fig</button>
      </template>
    </div>
    <div class="main">
      <div ref="canvasHost" class="canvas">
        <CanvasRoot>
          <CanvasSurface style="width:100%;height:100%" />
          <CanvasInput />
        </CanvasRoot>
      </div>
      <aside v-if="hosted" class="review" data-testid="review">
        <h3>Agent proposals</h3>
        <p v-if="!ui.proposals.length" class="muted">Nothing waiting for review.</p>
        <article v-for="proposal in ui.proposals" :key="proposal.id" class="proposal" :data-proposal="proposal.id">
          <header><strong>{{ proposal.title }}</strong><span class="muted"> · {{ proposal.opCount }} changes · based on rev {{ proposal.baseRev }}</span></header>
          <img v-for="(img, i) in proposal.preview" :key="i" :src="`data:image/png;base64,${img}`" alt="Proposal preview" />
          <div class="actions">
            <button class="primary" data-testid="accept" :disabled="ui.working" @click="decide(proposal, 'accept')">Accept</button>
            <button data-testid="reject" :disabled="ui.working" @click="decide(proposal, 'reject')">Reject</button>
          </div>
        </article>
        <p v-if="ui.message" class="message" data-testid="message">{{ ui.message }}</p>
        <ul v-if="ui.conflicts.length" class="conflicts" data-testid="conflicts">
          <li v-for="c in ui.conflicts" :key="c.index">change {{ c.index + 1 }}: layer {{ c.reason }}{{ c.fields ? ` (${c.fields.slice(0, 3).join(', ')})` : '' }}</li>
        </ul>
      </aside>
    </div>
  </div>
</template>
