// Packaged backend, executed from a temp copy of package.json + dist (no node_modules), against an
// in-memory broker that mirrors the host's semantics (CAS state; rule-checked binary .fig files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http'; import https from 'node:https'; import net from 'node:net';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const network = [];
for (const [mod, keys] of [[http, ['request', 'get']], [https, ['request', 'get']], [net, ['connect', 'createConnection']]]) for (const k of keys) mod[k] = (...a) => { network.push(k); throw new Error('network denied'); };
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => String(url).startsWith('file:') ? realFetch(url, init) : (network.push(String(url)), Promise.reject(new Error('network denied')));

function fakeBroker(cwd) {
  const state = new Map();
  const key = (input) => `${input.scope ?? 'session'}:${input.key}`;
  return {
    async call(method, input) {
      if (method === 'state.read') return state.get(key(input)) ?? null;
      if (method === 'state.compareAndSwap') {
        const prev = state.get(key(input));
        if ((prev?.revision ?? 0) !== input.expectedRevision) throw Object.assign(new Error('revision_conflict'), { code: 'revision_conflict' });
        const next = { revision: input.expectedRevision + 1, schema: 1, value: structuredClone(input.value) }; state.set(key(input), next); return next;
      }
      if (!String(input.path).endsWith('.fig') || String(input.path).includes('..')) throw Object.assign(new Error('invalid_path'), { code: 'invalid_path' });
      const file = join(cwd, input.path);
      if (method === 'workspace.read') { try { const b = await readFile(file); return { base64: b.toString('base64'), bytes: b.length, hash: sha(b) }; } catch { return null; } }
      if (method === 'workspace.commit') {
        let before = null; try { before = sha(await readFile(file)); } catch {}
        if (before !== input.expectedHash) throw Object.assign(new Error('file_conflict'), { code: 'file_conflict' });
        const bytes = Buffer.from(input.base64, 'base64'); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, bytes); return { hash: sha(bytes) };
      }
      throw new Error(`method ${method}`);
    },
  };
}

const LOGIN = [
  { op: 'create', ref: '$screen', parent: '$page', type: 'FRAME', props: { name: 'Login', width: 390, height: 844, fill: '#FFFFFF', layout: { mode: 'VERTICAL', gap: 16, padding: { top: 64, right: 24, bottom: 24, left: 24 } } } },
  { op: 'create', ref: '$title', parent: '$screen', type: 'TEXT', props: { name: 'Title', text: { content: '登录 / ログイン', font: { family: 'Noto Sans SC', style: 'Bold', size: 28 }, color: '#111827' } } },
  { op: 'create', ref: '$email', parent: '$screen', type: 'FRAME', props: { name: 'Email', fill: '#F3F4F6', radius: 12, sizingH: 'FILL', stroke: { color: '#E5E7EB', weight: 1 }, layout: { mode: 'HORIZONTAL', padding: { top: 14, right: 16, bottom: 14, left: 16 } } } },
  { op: 'create', ref: '$emailText', parent: '$email', type: 'TEXT', props: { text: { content: '邮箱 Email', font: { size: 16 }, color: '#9CA3AF' }, sizingH: 'FILL' } },
  { op: 'create', ref: '$button', parent: '$screen', type: 'FRAME', props: { name: 'Primary button', fill: '#4F46E5', radius: 12, sizingH: 'FILL', layout: { mode: 'HORIZONTAL', justify: 'CENTER', align: 'CENTER', padding: { top: 14, bottom: 14 } } } },
  { op: 'create', ref: '$buttonText', parent: '$button', type: 'TEXT', props: { text: { content: '登录', font: { style: 'Medium', size: 16 }, color: '#FFFFFF' } } },
];

test('packaged backend: propose → render → accept → save .fig → reopen; human-only, stale, locks; no network', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pencil-pkg-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const pkgRoot = join(dir, 'package'), cwd = join(dir, 'workspace');
  await mkdir(cwd, { recursive: true });
  await cp(new URL('../package.json', import.meta.url), join(pkgRoot, 'package.json'));
  await cp(new URL('../dist/', import.meta.url), join(pkgRoot, 'dist'), { recursive: true });
  const { createRuntime } = await import(join(pkgRoot, 'dist/runtime.js'));
  const rt = await createRuntime({ pluginId: '@chengzhiyi/pi-pencil', version: '0', generation: 1, broker: fakeBroker(cwd) });
  let n = 0;
  const call = (kind, action, input) => rt.invoke({ requestId: `r${++n}`, generation: 1, scope: { cwd, workspaceId: 'w', sessionId: 's' }, kind, action, input });
  const tools = (await rt.describe()).tools;
  assert.deepEqual(tools.map((x) => x.name), ['pencil_read_me', 'pencil_status', 'pencil_inspect', 'pencil_render', 'pencil_propose_changes']);

  const t0 = performance.now();
  const proposed = await call('tool', 'propose', { title: 'Login', ops: LOGIN });
  const coldMs = Math.round(performance.now() - t0);
  assert.equal(proposed.$hosted, 'tool-result');
  const info = JSON.parse(proposed.content[0].text);
  assert.equal(info.status, 'pending_review');
  const preview = proposed.content.find((c) => c.type === 'image');
  assert.ok(preview && Buffer.from(preview.data, 'base64').subarray(1, 4).toString() === 'PNG', 'preview PNG returned to the agent');

  // Human-only actions are refused to tools.
  await assert.rejects(call('tool', 'accept', { docId: info.docId, proposalId: info.proposalId }), (e) => e.reason === 'human_only');
  assert.equal((await call('action', 'get', { docId: info.docId })).rev, 0, 'nothing applied before acceptance');

  const accepted = await call('action', 'accept', { docId: info.docId, proposalId: info.proposalId });
  assert.deepEqual(accepted, { status: 'accepted', rev: 1, rebased: false });
  const inspected = await call('tool', 'inspect', { docId: info.docId, depth: 3 });
  const screen = inspected.nodes.find((x) => x.untrusted.name === 'Login');
  const kids = inspected.nodes.filter((x) => x.parent === screen.id);
  assert.deepEqual(screen.layout, { mode: 'VERTICAL', gap: 16, padding: [64, 24, 24, 24] });
  assert.ok(kids.slice(1).every((k) => k.w === 342), 'FILL children span the content width');
  for (let i = 1; i < kids.length; i++) assert.ok(Math.abs(kids[i].y - (kids[i - 1].y + kids[i - 1].h) - 16) < 0.6, 'gap 16, no overlap');
  assert.ok(kids.find((k) => k.untrusted.name === 'Email').h < 60, 'rows hug their height');

  // Stale proposal: base rev 1, then another accept moves rev to 2.
  const p2 = JSON.parse((await call('tool', 'propose', { docId: info.docId, title: 'Rename', baseRev: 1, ops: [{ op: 'update', id: screen.id, props: { name: 'Sign in' } }] })).content[0].text);
  const p3 = JSON.parse((await call('tool', 'propose', { docId: info.docId, title: 'Recolor', baseRev: 1, ops: [{ op: 'update', id: screen.id, props: { fill: '#F9FAFB' } }] })).content[0].text);
  await call('action', 'accept', { docId: info.docId, proposalId: p2.proposalId });
  // Field-level rebase: p3 writes `fill`, p2 changed `name` → p3 still applies, rebased.
  assert.deepEqual(await call('action', 'accept', { docId: info.docId, proposalId: p3.proposalId.slice(0, 5) }), { status: 'accepted', rev: 3, rebased: true }, 'prefix id + rebase');
  // Same field changed after the proposal → conflict, nothing applied.
  const p4 = JSON.parse((await call('tool', 'propose', { docId: info.docId, title: 'Title A', ops: [{ op: 'update', id: screen.id, props: { name: 'A' } }] })).content[0].text);
  const p5 = JSON.parse((await call('tool', 'propose', { docId: info.docId, title: 'Title B', ops: [{ op: 'update', id: screen.id, props: { name: 'B' } }] })).content[0].text);
  await call('action', 'accept', { docId: info.docId, proposalId: p4.proposalId });
  await assert.rejects(call('action', 'accept', { docId: info.docId, proposalId: p5.proposalId }), (e) => e.reason === 'conflict' && e.conflicts?.[0]?.reason === 'changed');
  assert.equal((await call('tool', 'inspect', { docId: info.docId, depth: 0 })).nodes.length >= 1, true);
  // Human lock → agent proposals touching the locked subtree are refused at proposal time.
  const button = (await call('tool', 'inspect', { docId: info.docId, depth: 3 })).nodes.find((x) => x.untrusted.name === 'Primary button');
  await call('action', 'lock', { docId: info.docId, nodeIds: [button.id] });
  await assert.rejects(call('tool', 'propose', { docId: info.docId, title: 'x', ops: [{ op: 'update', id: button.id, props: { fill: '#000000' } }] }), (e) => e.reason === 'node_locked');
  await assert.rejects(call('tool', 'lock', { docId: info.docId, nodeIds: [button.id], locked: false }), (e) => e.reason === 'human_only');
  await assert.rejects(call('tool', 'propose', { docId: info.docId, title: 'x', baseRev: 1, ops: [{ op: 'delete', id: screen.id }] }), (e) => e.reason === 'stale_base', 'agent must re-inspect before proposing');

  // Save → reopen from disk → same tree.
  const saved = await call('action', 'save', { docId: info.docId, path: 'designs/login.fig' });
  const onDisk = await readFile(join(cwd, 'designs/login.fig'));
  assert.equal(saved.hash, sha(onDisk));
  const opened = await call('action', 'open', { path: 'designs/login.fig' });
  const reopened = await call('tool', 'inspect', { docId: opened.docId, depth: 3 });
  const strip = (nodes) => nodes.filter((x) => x.type !== 'CANVAS').map(({ id, parent, ...rest }) => rest);
  assert.deepEqual(strip(reopened.nodes), strip((await call('tool', 'inspect', { docId: info.docId, depth: 3 })).nodes));
  await writeFile(join(cwd, 'designs/login.fig'), 'external edit');
  await assert.rejects(call('action', 'save', { docId: info.docId }), (e) => e.code === 'file_conflict', 'external change is never overwritten');

  // Scoped task: human selected the Email row; agent may not touch the title.
  const email = reopened.nodes.find((x) => x.untrusted.name === 'Email');
  const title = reopened.nodes.find((x) => x.untrusted.name === 'Title');
  await call('action', 'selection', { docId: opened.docId, nodeIds: [email.id], task: true });
  await assert.rejects(call('tool', 'propose', { docId: opened.docId, title: 'x', ops: [{ op: 'update', id: title.id, props: { name: 'H1' } }] }), (e) => e.reason === 'out_of_scope');
  const scoped = await call('tool', 'propose', { docId: opened.docId, title: 'Email radius', ops: [{ op: 'update', id: email.id, props: { radius: 8 } }] });
  assert.equal(JSON.parse(scoped.content[0].text).status, 'pending_review');
  const status = await call('tool', 'status', {});
  assert.deepEqual(status.selection.nodeIds, [email.id]);

  assert.deepEqual(network, [], 'backend made no network calls');
  console.log(JSON.stringify({ coldProposeMs: coldMs, figBytes: onDisk.length }));
  await rt.dispose();
});
