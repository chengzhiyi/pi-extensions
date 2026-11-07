// pi-pencil backend runtime (spike). Authoritative design documents live here (headless
// open-pencil core in the host's Node child process). Agent writes are proposals; only human
// frame actions (kind:"action") accept, reject or save.
import { randomUUID, createHash } from 'node:crypto';
import { initEngine, figmaFor, newGraph, readFig, writeFig, layout, renderPng, project } from '../adapter/engine.js';
import { applyOps, OpError } from '../adapter/ops.js';
import { pencilTools, reference, validateOps, ID } from '../contract/tools.js';
import { preconditions, conflicts } from './rebase.js';

const ASSETS = new URL('./assets/', import.meta.url).href;
const HUMAN_ONLY = new Set(['accept', 'reject', 'save', 'open', 'selection', 'sync', 'lock']);
const MAX_FIG_BYTES = 32 * 1024 * 1024;
const MAX_PROPOSALS = 20;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const b64 = (u8) => Buffer.from(u8).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
class PencilError extends Error { constructor(message, status = 400, reason) { super(message); this.status = status; this.reason = reason; } }
const fail = (message, status, reason) => { throw new PencilError(message, status, reason); };
const id = (v, what) => (typeof v === 'string' && new RegExp(ID).test(v) ? v : fail(`Invalid ${what}`, 400, 'invalid_input'));

export const createRuntime = (ctx) => {
  let disposed = false;
  let queue = Promise.resolve();
  const broker = ctx.broker;
  const ws = { scope: 'workspace' };

  async function readRecord(key, scope = ws) {
    const s = await broker.call('state.read', { key, ...scope });
    return s ? { revision: s.revision, value: s.value } : { revision: 0, value: null };
  }
  async function writeRecord(key, rec, value, scope = ws) {
    return broker.call('state.compareAndSwap', { key, expectedRevision: rec.revision, schema: 1, value, ...scope });
  }
  async function loadDesign(docId) {
    const rec = await readRecord(`design.${id(docId, 'docId')}`);
    if (!rec.value) fail(`Design ${docId} not found`, 404, 'design_unavailable');
    return rec;
  }
  async function graphOf(design) { return design.fig ? readFig(unb64(design.fig)) : seedGraph(); }
  function seedGraph() { const g = newGraph(); return g; }
  async function index() { const rec = await readRecord('index'); return { rec, docs: rec.value?.docs ?? [] }; }

  function topFrames(graph) {
    const page = graph.getPages()[0];
    return (graph.getNode(page.id).childIds ?? []).map((c) => graph.getNode(c)).filter(Boolean);
  }
  // Real-model finding: 0.5x previews (195 px) were too small to judge; render at 1x, ≤ 1200 px edge.
  async function renderTargets(graph, ids, scale = 1) {
    const out = [];
    for (const nodeId of ids.slice(0, 4)) { const png = await renderPng(graph, nodeId, { scale, maxEdge: 1200 }); if (png) out.push(b64(png)); }
    return out;
  }
  /** Exact id, or a unique prefix of ≥ 4 chars (models mistype 8-char ids). */
  function findProposal(design, ref) {
    if (typeof ref !== 'string' || ref.length < 4) fail('Unknown proposal', 404, 'unknown_proposal');
    const exact = design.proposals.find((x) => x.id === ref);
    if (exact) return exact;
    const matches = design.proposals.filter((x) => x.id.startsWith(ref) || ref.startsWith(x.id));
    return matches.length === 1 ? matches[0] : fail(matches.length ? 'Ambiguous proposal id' : 'Unknown proposal', 404, 'unknown_proposal');
  }
  async function commitGraph(rec, design, graph, batch) {
    const before = design.fig;
    design.fig = b64(await writeFig(graph)); design.rev += 1;
    design.batches = [...(design.batches ?? []), { ...batch, appliedRev: design.rev, before }].slice(-10);
    await writeRecord(`design.${design.docId}`, rec, design);
    return design.rev;
  }
  const result = (text, images = [], details) => ({ $hosted: 'tool-result', content: [{ type: 'text', text }, ...images.map((data) => ({ type: 'image', data, mimeType: 'image/png' }))], details: details ?? JSON.parse(text) });

  async function tool(action, input, scope) {
    switch (action) {
      case 'reference': return reference();
      case 'status': {
        const { docs } = await index();
        const designs = [];
        for (const docId of docs.slice(0, 50)) {
          const v = (await readRecord(`design.${docId}`)).value; if (!v) continue;
          designs.push({ docId, rev: v.rev, path: v.path, saved: v.savedRev === v.rev, untrusted: { title: v.title },
            proposals: v.proposals.filter((p) => p.status === 'pending').map((p) => ({ id: p.id, baseRev: p.baseRev, ops: p.ops.length, untrusted: { title: p.title } })) });
        }
        const session = (await readRecord('session', {})).value;
        return { designs, selection: session?.selection ?? null };
      }
      case 'inspect': {
        const rec = await loadDesign(input.docId); const graph = await graphOf(rec.value);
        const root = input.nodeId ? id(input.nodeId, 'nodeId') : graph.getPages()[0].id;
        if (!graph.getNode(root)) fail(`Unknown node ${root}`, 404, 'unknown_node');
        return { docId: rec.value.docId, rev: rec.value.rev, nodes: project(graph, root, Math.min(input.depth ?? 3, 6)) };
      }
      case 'render': {
        const rec = await loadDesign(input.docId);
        if (input.proposalId) {
          const p = findProposal(rec.value, input.proposalId);
          return result(JSON.stringify({ proposalId: p.id, status: p.status, images: p.preview.length }), p.preview);
        }
        const graph = await graphOf(rec.value);
        const ids = input.nodeId ? [id(input.nodeId, 'nodeId')] : topFrames(graph).map((n) => n.id);
        if (!ids.length) return { message: 'Design is empty' };
        const images = await renderTargets(graph, ids, input.scale ?? 0.75);
        return result(JSON.stringify({ docId: rec.value.docId, rev: rec.value.rev, rendered: ids.slice(0, 4) }), images);
      }
      case 'propose': {
        const ops = validateOps(input.ops);
        const title = typeof input.title === 'string' && input.title.length <= 120 ? input.title : fail('title required', 400, 'invalid_input');
        let docId = input.docId, rec;
        if (docId) rec = await loadDesign(docId);
        else {
          docId = randomUUID().slice(0, 8);
          rec = { revision: 0, value: { schema: 1, docId, title, rev: 0, fig: null, path: null, diskHash: null, savedRev: null, proposals: [] } };
          const idx = await index();
          await writeRecord('index', idx.rec, { docs: [...idx.docs, docId] });
        }
        const design = rec.value;
        if (input.baseRev !== undefined && input.baseRev !== design.rev) fail(`Design is at rev ${design.rev}; inspect again and rebase`, 409, 'stale_base');
        if (design.proposals.filter((p) => p.status === 'pending').length >= 5) fail('Too many pending proposals; wait for the human to decide', 429, 'too_many_pending');
        // Apply to a fork to validate (locks/scope/existence) and to render the preview.
        const graph = await graphOf(design);
        const figma = await figmaFor(graph);
        const session = (await readRecord('session', {})).value;
        const pre = preconditions(graph, ops);
        let applied;
        try { applied = await applyOps(figma, graph, ops, { scope: session?.task?.docId === docId ? new Set(session.task.nodeIds) : null }); }
        catch (error) { if (error instanceof OpError) fail(error.message, error.status, error.reason); throw error; }
        layout(graph);
        const previewIds = applied.roots.length ? applied.roots : topFrames(graph).filter((n) => applied.touched.some((t) => isWithin(graph, t, n.id))).map((n) => n.id);
        const preview = await renderTargets(graph, previewIds);
        const proposal = { id: randomUUID().slice(0, 8), title, baseRev: design.rev, ops, pre, status: 'pending', sessionId: scope.sessionId, createdAt: new Date().toISOString(), preview, touched: applied.touched.length };
        design.proposals = [...design.proposals, proposal].slice(-MAX_PROPOSALS);
        await writeRecord(`design.${docId}`, rec, design);
        const text = JSON.stringify({ docId, proposalId: proposal.id, status: 'pending_review', baseRev: design.rev, createdNodes: Object.keys(applied.refs).length, message: 'Proposal created. Nothing is applied until the human accepts it in Pencil.' });
        return result(text, preview);
      }
      default: fail('Unknown tool action', 400);
    }
  }

  async function action(name, input, scope) {
    switch (name) {
      case 'list': {
        const { docs } = await index();
        const out = [];
        for (const docId of docs) { const v = (await readRecord(`design.${docId}`)).value; if (v) out.push({ docId, title: v.title, rev: v.rev, path: v.path, pending: v.proposals.filter((p) => p.status === 'pending').length }); }
        return out;
      }
      case 'get': {
        const rec = await loadDesign(input.docId); const v = rec.value;
        if (input.sinceRev !== undefined && input.sinceRev === v.rev) return { docId: v.docId, rev: v.rev, unchanged: true, proposals: v.proposals.map(({ ops, pre, ...p }) => ({ ...p, opCount: ops.length })) };
        return { docId: v.docId, title: v.title, rev: v.rev, path: v.path, savedRev: v.savedRev, fig: v.fig, proposals: v.proposals.map(({ ops, pre, ...p }) => ({ ...p, opCount: ops.length })) };
      }
      case 'accept': case 'reject': {
        const rec = await loadDesign(input.docId); const design = rec.value;
        const p = findProposal(design, input.proposalId);
        if (p.status !== 'pending') fail(`Proposal is ${p.status}`, 409, 'proposal_decided');
        if (name === 'reject') { p.status = 'rejected'; p.preview = []; await writeRecord(`design.${design.docId}`, rec, design); return { status: 'rejected', rev: design.rev }; }
        const graph = await graphOf(design);
        // Field-level rebase: the design moved on since the proposal; apply only if every field the
        // proposal writes is still what the agent saw (otherwise list conflicts, apply nothing).
        if (p.baseRev !== design.rev) {
          const found = conflicts(graph, p.pre ?? []);
          if (found.length) {
            p.status = 'conflicted'; p.conflicts = found;
            await writeRecord(`design.${design.docId}`, rec, design);
            throw Object.assign(new PencilError(`${found.length} change(s) conflict with edits made after this proposal; ask the agent to rebase`, 409, 'conflict'), { conflicts: found });
          }
        }
        try { await applyOps(await figmaFor(graph), graph, p.ops); }
        catch (error) { if (error instanceof OpError) { p.status = 'conflicted'; await writeRecord(`design.${design.docId}`, rec, design); fail(error.message, error.status, error.reason); } throw error; }
        layout(graph);
        const rebased = p.baseRev !== design.rev;
        p.status = 'accepted'; p.preview = []; p.rebased = rebased;
        const rev = await commitGraph(rec, design, graph, { kind: 'agent', proposalId: p.id });
        return { status: 'accepted', rev, rebased };
      }
      case 'save': {
        const rec = await loadDesign(input.docId); const design = rec.value;
        if (!design.fig) fail('Nothing to save', 409);
        const path = typeof input.path === 'string' ? input.path : design.path ?? `designs/${design.title.replace(/[^\w一-鿿-]+/g, '-').slice(0, 60) || design.docId}.fig`;
        const bytes = unb64(design.fig);
        const expectedHash = path === design.path ? design.diskHash : null;
        const saved = await broker.call('workspace.commit', { path, base64: design.fig, expectedHash });
        if (saved.hash !== sha(bytes)) fail('Saved hash mismatch', 500);
        design.path = path; design.diskHash = saved.hash; design.savedRev = design.rev;
        await writeRecord(`design.${design.docId}`, rec, design);
        return { path, hash: saved.hash, bytes: bytes.length, rev: design.rev };
      }
      case 'open': {
        const path = String(input.path ?? '');
        const file = await broker.call('workspace.read', { path, encoding: 'base64' }) ?? fail('File not found', 404);
        const graph = await readFig(unb64(file.base64)); // validates the file
        const docId = randomUUID().slice(0, 8);
        const design = { schema: 1, docId, title: path.split('/').pop().replace(/\.fig$/, ''), rev: 1, fig: b64(await writeFig(graph)), path, diskHash: file.hash, savedRev: null, proposals: [] };
        const idx = await index();
        await writeRecord('index', idx.rec, { docs: [...idx.docs, docId] });
        await writeRecord(`design.${docId}`, { revision: 0 }, design);
        return { docId, rev: design.rev, nodes: project(graph, graph.getPages()[0].id, 1).length };
      }
      case 'sync': {
        // Human edits from the editor frame (snapshot sync; Yjs replica is S6). Never merges silently:
        // a frame that is behind must reload first.
        const rec = await loadDesign(input.docId); const design = rec.value;
        if (input.baseRev !== design.rev) fail(`Design is at rev ${design.rev}; reload before syncing`, 409, 'stale_base');
        if (typeof input.fig !== 'string' || input.fig.length > MAX_FIG_BYTES * 1.4) fail('Invalid document', 400, 'invalid_input');
        const graph = await readFig(unb64(input.fig)); // validates
        const rev = await commitGraph(rec, design, graph, { kind: 'human' });
        return { rev };
      }
      case 'lock': {
        const rec = await loadDesign(input.docId); const design = rec.value;
        const ids = (Array.isArray(input.nodeIds) ? input.nodeIds : []).slice(0, 100).map((n) => id(n, 'nodeId'));
        if (!ids.length) fail('nodeIds required', 400, 'invalid_input');
        const graph = await graphOf(design); const figma = await figmaFor(graph);
        for (const nodeId of ids) { const node = figma.getNodeById(nodeId) ?? fail(`Unknown node ${nodeId}`, 404, 'unknown_node'); node.locked = input.locked !== false; }
        const rev = await commitGraph(rec, design, graph, { kind: 'lock', nodeIds: ids });
        return { rev, locked: input.locked !== false, nodeIds: ids };
      }
      case 'selection': {
        const rec = await readRecord('session', {});
        const selection = { docId: id(input.docId, 'docId'), nodeIds: (Array.isArray(input.nodeIds) ? input.nodeIds : []).slice(0, 100).map((n) => id(n, 'nodeId')), at: new Date().toISOString() };
        await writeRecord('session', rec, { ...(rec.value ?? {}), selection, ...(input.task ? { task: { docId: selection.docId, nodeIds: selection.nodeIds } } : {}) }, {});
        return selection;
      }
      default: fail('Unknown action', 400);
    }
  }

  return {
    describe: () => ({ tools: pencilTools().map((t) => ({ ...t, label: t.name })) }),
    health: () => ({ ok: !disposed, schema: 1 }),
    invoke(request) {
      const run = queue.catch(() => {}).then(async () => {
        if (disposed) fail('Plugin disposed', 409);
        if (request.generation !== ctx.generation || !request.scope?.sessionId) fail('Stale generation or invalid scope', 409);
        if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) fail('Invalid input', 400);
        if (request.kind === 'tool' && HUMAN_ONLY.has(request.action)) fail('This action is reserved for the human', 403, 'human_only');
        await initEngine(ASSETS);
        return request.kind === 'tool' ? tool(request.action, request.input, request.scope) : action(request.action, request.input, request.scope);
      });
      queue = run;
      return run;
    },
    async dispose() { disposed = true; await queue.catch(() => {}); },
  };
};

function isWithin(graph, id, ancestor) { for (let n = graph.getNode(id); n; n = n.parentId ? graph.getNode(n.parentId) : null) if (n.id === ancestor) return true; return false; }
