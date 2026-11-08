// Packaged backend, executed from a temp copy of package.json + dist (no node_modules), against an
// in-memory broker that mirrors the host's semantics (CAS state; rule-checked binary .fig files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// This tests the packaged build. CI runs the tests before `pnpm build`, so build it first when dist/ is missing.
const packageDir = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(join(packageDir, 'dist/resources.json'))) execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir, stdio: 'inherit' });

test('packaged backend: apply → inspect → undo → save .fig → reopen; human-only, stale, locks; no network', async (t) => {
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
  assert.deepEqual(tools.map((x) => x.name), ['pencil_read_me', 'pencil_status', 'pencil_inspect', 'pencil_render', 'pencil_apply_changes']);

  const t0 = performance.now();
  const applied = await call('tool', 'apply', { title: 'Login', ops: LOGIN });
  const coldMs = Math.round(performance.now() - t0);
  assert.equal(applied.$hosted, 'tool-result');
  const info = JSON.parse(applied.content[0].text);
  assert.equal(info.status, 'applied');
  assert.equal(info.rev, 1, 'the agent change is the new revision at once');
  const preview = applied.content.find((c) => c.type === 'image');
  assert.ok(preview && Buffer.from(preview.data, 'base64').subarray(1, 4).toString() === 'PNG', 'render of the change returned to the agent');
  const got = await call('action', 'get', { docId: info.docId });
  assert.equal(got.rev, 1);
  assert.equal(got.changes[0].title, 'Login');
  assert.equal(got.changes[0].undoable, true);
  assert.ok(got.changes[0].nodeIds.length === 1, 'the new screen is named so the editor can select it');

  // Human-only actions are refused to tools; the old propose action is gone.
  await assert.rejects(call('tool', 'revert', { docId: info.docId }), (e) => e.reason === 'human_only');
  await assert.rejects(call('tool', 'propose', { title: 'x', ops: LOGIN }), (e) => e.status === 400);

  const inspected = await call('tool', 'inspect', { docId: info.docId, depth: 3 });
  const screen = inspected.nodes.find((x) => x.untrusted.name === 'Login');
  const kids = inspected.nodes.filter((x) => x.parent === screen.id);
  assert.deepEqual(screen.layout, { mode: 'VERTICAL', gap: 16, padding: [64, 24, 24, 24] });
  assert.ok(kids.slice(1).every((k) => k.w === 342), 'FILL children span the content width');
  for (let i = 1; i < kids.length; i++) assert.ok(Math.abs(kids[i].y - (kids[i - 1].y + kids[i - 1].h) - 16) < 0.6, 'gap 16, no overlap');
  assert.ok(kids.find((k) => k.untrusted.name === 'Email').h < 60, 'rows hug their height');

  // Undo: the agent's latest change can be reverted by the person, once; the undo is a new revision.
  await call('tool', 'apply', { docId: info.docId, title: 'Rename', baseRev: 1, ops: [{ op: 'update', id: screen.id, props: { name: 'Sign in' } }] });
  assert.deepEqual(await call('action', 'revert', { docId: info.docId, rev: 2 }), { rev: 3, title: 'Rename' });
  assert.equal((await call('tool', 'inspect', { docId: info.docId, depth: 1 })).nodes.find((x) => x.id === screen.id).untrusted.name, 'Login', 'rename undone');
  await assert.rejects(call('action', 'revert', { docId: info.docId }), (e) => e.reason === 'not_revertible', 'an undo is not undone again');
  const afterUndo = await call('action', 'get', { docId: info.docId });
  assert.deepEqual(afterUndo.changes.map((c) => [c.title, c.reverted, c.undoable]), [['Rename', true, false], ['Login', false, false]]);
  // A person's edit after the agent's change makes it no longer undoable (nothing of theirs is lost).
  await call('tool', 'apply', { docId: info.docId, title: 'Recolor', baseRev: 3, ops: [{ op: 'update', id: screen.id, props: { fill: '#F9FAFB' } }] });
  await call('action', 'sync', { docId: info.docId, baseRev: 4, fig: afterUndo.fig });
  await assert.rejects(call('action', 'revert', { docId: info.docId }), (e) => e.reason === 'not_revertible');
  // Stale base: the agent read rev 1, the person moved on → it must inspect again.
  await assert.rejects(call('tool', 'apply', { docId: info.docId, title: 'x', baseRev: 1, ops: [{ op: 'delete', id: screen.id }] }), (e) => e.reason === 'stale_base', 'agent must re-inspect before applying');

  // Human lock → agent changes touching the locked subtree are refused.
  const button = (await call('tool', 'inspect', { docId: info.docId, depth: 3 })).nodes.find((x) => x.untrusted.name === 'Primary button');
  await call('action', 'lock', { docId: info.docId, nodeIds: [button.id] });
  await assert.rejects(call('tool', 'apply', { docId: info.docId, title: 'x', ops: [{ op: 'update', id: button.id, props: { fill: '#000000' } }] }), (e) => e.reason === 'node_locked');
  await assert.rejects(call('tool', 'lock', { docId: info.docId, nodeIds: [button.id], locked: false }), (e) => e.reason === 'human_only');

  // Interactive components: a switch (two variants + behaviour) and a text field (text property bound to a
  // child), each placed in the screen as an instance. These are what Preview runs as live controls.
  const readMe = await call('tool', 'reference', {});
  assert.ok(readMe.interactive?.length && readMe.interactiveExample, 'read_me teaches interactive components');
  const ui = await call('tool', 'inspect', { docId: info.docId, depth: 1 });
  const switchOps = readMe.interactiveExample.ops.map((o) => o.ref === '$wifi' ? { ...o, parent: screen.id } : o);
  const interactiveRev = ui.rev;
  await assert.rejects(call('tool', 'apply', { docId: info.docId, title: 'x', baseRev: interactiveRev, ops: switchOps.map((o) => o.op === 'variants' ? { ...o, props: { name: 'Switch', behaviour: { kind: 'switch' } } } : o) }),
    (e) => e.reason === 'behaviour_incomplete' && /value/.test(e.message), 'a switch with no bound value is refused with what is missing');
  assert.equal((await call('action', 'get', { docId: info.docId })).rev, interactiveRev, 'a refused batch changes nothing');
  const built = JSON.parse((await call('tool', 'apply', { docId: info.docId, title: 'Wi-Fi switch', baseRev: interactiveRev, ops: [...switchOps,
    { op: 'create', ref: '$field', parent: '$page', type: 'COMPONENT', props: { name: 'Email field', x: -600, y: 80, width: 240, height: 44, radius: 10, fill: '#F3F4F6', properties: [{ name: 'Value', type: 'TEXT', default: 'Email' }], layout: { mode: 'HORIZONTAL', align: 'CENTER', padding: { left: 12, right: 12 } } } },
    { op: 'create', ref: '$fieldText', parent: '$field', type: 'TEXT', props: { text: { content: 'Email', color: '#6B7280' }, bind: { text: 'Value' } } },
    { op: 'update', id: '$field', props: { behaviour: { kind: 'textField', values: { value: 'Value' } } } },
    { op: 'create', ref: '$email', parent: screen.id, type: 'INSTANCE', component: '$field' },
  ] })).content[0].text);
  const tree = (await call('tool', 'inspect', { docId: info.docId, depth: 4 })).nodes;
  const typeOf = (ref) => tree.find((n) => n.id === built.nodes[ref])?.type;
  assert.deepEqual(['$switch', '$wifi', '$field', '$email'].map(typeOf), ['COMPONENT_SET', 'INSTANCE', 'COMPONENT', 'INSTANCE']);
  assert.equal(tree.find((n) => n.id === built.nodes.$wifi).parent, screen.id, 'the switch instance sits in the screen');
  await assert.rejects(call('tool', 'apply', { docId: info.docId, title: 'x', ops: [{ op: 'create', ref: '$i', parent: screen.id, type: 'INSTANCE', component: screen.id }] }), (e) => e.reason === 'invalid_op', 'only components can be instantiated');
  await assert.rejects(call('tool', 'apply', { docId: info.docId, title: 'x', ops: [{ op: 'update', id: screen.id, props: { behaviour: { kind: 'button' } } }] }), (e) => /COMPONENT/.test(e.message), 'a plain frame cannot take a behaviour');

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
  await assert.rejects(call('tool', 'apply', { docId: opened.docId, title: 'x', ops: [{ op: 'update', id: title.id, props: { name: 'H1' } }] }), (e) => e.reason === 'out_of_scope');
  const scoped = await call('tool', 'apply', { docId: opened.docId, title: 'Email radius', ops: [{ op: 'update', id: email.id, props: { radius: 8 } }] });
  assert.equal(JSON.parse(scoped.content[0].text).status, 'applied');
  const status = await call('tool', 'status', {});
  assert.deepEqual(status.selection.nodeIds, [email.id]);

  assert.deepEqual(network, [], 'backend made no network calls');
  console.log(JSON.stringify({ coldApplyMs: coldMs, figBytes: onDisk.length }));
  await rt.dispose();
});

test('packaged backend: open workspace .fig (reuse), import .fig/.pen/.drawio, refuse bad files, migrate records', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pencil-import-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const pkgRoot = join(dir, 'package'), cwd = join(dir, 'workspace');
  await mkdir(cwd, { recursive: true });
  await cp(new URL('../package.json', import.meta.url), join(pkgRoot, 'package.json'));
  await cp(new URL('../dist/', import.meta.url), join(pkgRoot, 'dist'), { recursive: true });
  const { createRuntime } = await import(join(pkgRoot, 'dist/runtime.js'));
  const broker = fakeBroker(cwd);
  const rt = await createRuntime({ pluginId: '@chengzhiyi/pi-pencil', version: '0', generation: 1, broker });
  let n = 0;
  const call = (kind, action, input) => rt.invoke({ requestId: `r${++n}`, generation: 1, scope: { cwd, workspaceId: 'w', sessionId: 's' }, kind, action, input });
  const names = async (docId) => (await call('tool', 'inspect', { docId, depth: 4 })).nodes.map((x) => x.untrusted?.name).filter(Boolean);

  // A design saved to the workspace, then opened from its path.
  const made = JSON.parse((await call('tool', 'apply', { title: 'Login', ops: LOGIN })).content[0].text);
  await call('action', 'save', { docId: made.docId, path: 'designs/login.fig' });
  const again = await call('action', 'open', { path: './designs/login.fig' });
  assert.equal(again.docId, made.docId, 'an already-open, unchanged file switches to its design');
  assert.equal(again.reused, true);
  await cp(join(cwd, 'designs/login.fig'), join(cwd, 'designs/copy.fig'));
  const opened = await call('action', 'open', { path: 'designs/copy.fig' });
  assert.notEqual(opened.docId, made.docId);
  assert.equal(opened.title, 'copy');
  assert.ok((await names(opened.docId)).includes('Email'));
  const got = await call('action', 'get', { docId: opened.docId });
  assert.equal(got.savedRev, got.rev, 'a freshly opened file counts as saved');
  assert.equal(got.path, 'designs/copy.fig');
  await assert.rejects(call('action', 'open', { path: 'designs/missing.fig' }), (e) => e.reason === 'file_not_found');
  await assert.rejects(call('action', 'open', { path: 'notes.txt' }), (e) => e.reason === 'invalid_input');
  await writeFile(join(cwd, 'designs/broken.fig'), 'not a fig');
  await assert.rejects(call('action', 'open', { path: 'designs/broken.fig' }), (e) => e.reason === 'invalid_file');
  await assert.rejects(call('tool', 'import', { name: 'x.fig', data: 'AA==' }), (e) => e.reason === 'human_only');

  // Import from the person's computer: a .fig round-trips; other formats go through OpenPencil's readers.
  const figBytes = await readFile(join(cwd, 'designs/login.fig'));
  const fig = await call('action', 'import', { name: 'Old Login.fig', data: figBytes.toString('base64') });
  assert.equal(fig.title, 'Old Login');
  assert.ok((await names(fig.docId)).includes('Primary button'));
  assert.equal((await call('action', 'get', { docId: fig.docId })).path, null, 'an import has no workspace path until saved');
  const savedImport = await call('action', 'save', { docId: fig.docId });
  assert.equal(savedImport.path, 'designs/Old-Login.fig');

  const pen = { version: '2.6', children: [{ type: 'frame', id: 'card', name: 'Card', x: 0, y: 0, width: 240, height: 120, fill: '#4F46E5', children: [{ type: 'text', id: 'hi', name: 'Greeting', content: 'Hello', fill: '#FFFFFF' }] }] };
  const penDoc = await call('action', 'import', { name: 'card.pen', data: Buffer.from(JSON.stringify(pen)).toString('base64') });
  const penNames = await names(penDoc.docId);
  assert.ok(penNames.includes('Card') && penNames.includes('Greeting'), `pen layers: ${penNames}`);

  const drawio = '<mxfile><diagram name="Flow"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Start" style="rounded=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
  const flow = await call('action', 'import', { name: 'flow.drawio', data: Buffer.from(drawio).toString('base64') });
  assert.ok(flow.nodes > 0, 'draw.io diagram has nodes');

  // Mermaid needs elkjs for layout, which is not bundled: refused up front, not half-read.
  await assert.rejects(call('action', 'import', { name: 'steps.mmd', data: Buffer.from('flowchart TD\n  A --> B\n').toString('base64') }), (e) => e.reason === 'unsupported_format');

  await assert.rejects(call('action', 'import', { name: 'photo.png', data: 'AA==' }), (e) => e.reason === 'unsupported_format' && /\.pen/.test(e.message));
  await assert.rejects(call('action', 'import', { name: 'broken.pen', data: Buffer.from('{"nope":1}').toString('base64') }), (e) => e.reason === 'invalid_file');
  await assert.rejects(call('action', 'import', { name: 'empty.fig', data: '' }), (e) => e.reason === 'too_large');

  // Stored records: an early schema-1 record without newer fields still loads; a newer schema is refused, not rewritten.
  const raw = await broker.call('state.read', { key: `design.${made.docId}`, scope: 'workspace' });
  const { batches, savedRev, schema, ...early } = raw.value;
  await broker.call('state.compareAndSwap', { key: `design.${made.docId}`, scope: 'workspace', expectedRevision: raw.revision, value: early });
  const early1 = await call('action', 'get', { docId: made.docId });
  assert.equal(early1.savedRev, null);
  await call('action', 'rename', { docId: made.docId, title: 'Login v1' });
  assert.equal((await broker.call('state.read', { key: `design.${made.docId}`, scope: 'workspace' })).value.schema, 1, 'a migrated record is written at the current schema');
  const now = await broker.call('state.read', { key: `design.${made.docId}`, scope: 'workspace' });
  await broker.call('state.compareAndSwap', { key: `design.${made.docId}`, scope: 'workspace', expectedRevision: now.revision, value: { ...now.value, schema: 99 } });
  await assert.rejects(call('action', 'get', { docId: made.docId }), (e) => e.reason === 'schema_newer');
  assert.ok(!(await call('action', 'list', {})).some((d) => d.docId === made.docId), 'a newer record is left out of the list');
  assert.equal((await broker.call('state.read', { key: `design.${made.docId}`, scope: 'workspace' })).value.schema, 99, 'and left untouched');
});
