// Human–agent loop in a real browser: the built editor frame (per-plugin CSP) talks the hosted-v2
// handshake + MessagePort protocol to a parent page; its `action` calls reach the packaged backend
// runtime (in-memory broker with host semantics). Agent tool calls are issued from Node.
// Covers: review panel accept/reject, human edit sync, field-level rebase, conflicts, locks,
// selection scope, .fig save, zero CSP violations/external requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const DIST = new URL('../dist/', import.meta.url).pathname;
const OUT = new URL('../.cache/loop/', import.meta.url);
await mkdir(OUT, { recursive: true });
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json' };
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- backend: packaged runtime + broker with the host's semantics ----
const cwd = await mkdtemp(join(tmpdir(), 'pencil-loop-'));
const state = new Map(); const key = (i) => `${i.scope ?? 'session'}:${i.key}`;
const broker = { async call(method, input) {
  if (method === 'state.read') return state.get(key(input)) ?? null;
  if (method === 'state.compareAndSwap') { const prev = state.get(key(input)); if ((prev?.revision ?? 0) !== input.expectedRevision) throw Object.assign(new Error('revision_conflict'), { code: 'revision_conflict' }); const next = { revision: input.expectedRevision + 1, schema: 1, value: structuredClone(input.value) }; state.set(key(input), next); return next; }
  const file = join(cwd, input.path);
  if (method === 'workspace.read') { try { const b = await readFile(file); return { base64: b.toString('base64'), hash: sha(b) }; } catch { return null; } }
  if (method === 'workspace.commit') { let before = null; try { before = sha(await readFile(file)); } catch {} if (before !== input.expectedHash) throw Object.assign(new Error('file_conflict'), { code: 'file_conflict' }); const b = Buffer.from(input.base64, 'base64'); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, b); return { hash: sha(b) }; }
  throw new Error(method);
} };
const { createRuntime } = await import(new URL('../dist/runtime.js', import.meta.url).href);
const rt = await createRuntime({ pluginId: '@chengzhiyi/pi-pencil', version: '0.0.1', generation: 1, broker });
let n = 0;
const invoke = (kind, action, input) => rt.invoke({ requestId: `r${++n}`, generation: 1, scope: { cwd, workspaceId: 'w', sessionId: 's' }, kind, action, input });
const agent = async (action, input) => { const r = await invoke('tool', action, input); return r?.$hosted ? JSON.parse(r.content[0].text) : r; };

// ---- HTTP: frame assets with the per-plugin CSP; parent page; /rpc for frame actions ----
const actionsSeen = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/rpc' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    const { action, input } = JSON.parse(body); actionsSeen.push(action);
    try { res.end(JSON.stringify({ ok: true, value: await invoke('action', action, input) })); }
    catch (e) { res.end(JSON.stringify({ ok: false, error: { code: e.code ?? 'error', message: e.message, status: e.status, reason: e.reason, conflicts: e.conflicts } })); }
    return;
  }
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><body style="margin:0"><iframe id="f" style="width:1280px;height:860px;border:0"></iframe><script type="module">
      const f = document.getElementById('f'), origin = location.origin;
      f.src = '/frame.html?' + new URLSearchParams({ parentOrigin: origin, pluginId: '@chengzhiyi/pi-pencil', generation: '1', mountId: 'm1' });
      window.hostLog = [];
      f.addEventListener('load', () => {
        const ch = new MessageChannel(); const port = ch.port1; let seq = 0; const pending = new Map();
        port.onmessage = async ({ data }) => {
          if (data.type === 'response') { const w = pending.get(data.id); pending.delete(data.id); data.ok ? w.resolve(data.value) : w.reject(data.error); return; }
          let value = null, error = null;
          try {
            if (data.method === 'action') { const r = await (await fetch('/rpc', { method: 'POST', body: JSON.stringify(data.input) })).json(); if (r.ok) value = r.value; else error = r.error; }
            else window.hostLog.push([data.method, data.input]);
          } catch (e) { error = { code: 'host_error', message: String(e) }; }
          port.postMessage(error ? { type: 'response', id: data.id, ok: false, error } : { type: 'response', id: data.id, ok: true, value });
        };
        port.start();
        f.contentWindow.postMessage({ type: 'pi:hosted:connect', protocol: 1, pluginId: '@chengzhiyi/pi-pencil', generation: 1, mountId: 'm1' }, origin, [ch.port2]);
        const call = (method, input) => new Promise((resolve, reject) => { const id = 'h' + (++seq); pending.set(id, { resolve, reject }); port.postMessage({ type: 'request', id, method, input }); });
        window.hostCall = call;
        call('initialize', { kind: 'editor', sessionId: 's', locale: 'zh', theme: 'light' });
      }, { once: true });
    </script>`);
    return;
  }
  const path = join(DIST, decodeURIComponent(url.pathname));
  if (!path.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(path); res.setHeader('Content-Security-Policy', CSP); res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream'); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const issues = { violations: [], pageErrors: [], external: [] };
const steps = [];
const step = (name, data) => { steps.push({ name, ...data }); console.log(`✔ ${name}`, data ? JSON.stringify(data) : ''); };
try {
  const LOGIN = JSON.parse(await readFile(new URL('./fixtures/login-ops.json', import.meta.url), 'utf8'));
  const first = await agent('propose', { title: 'Login screen', ops: LOGIN });
  const docId = first.docId;

  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) issues.external.push(r.url()); });
  page.on('pageerror', (e) => issues.pageErrors.push(String(e.message).slice(0, 300)));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => { (globalThis.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`); }));
  await page.goto(origin + '/');
  const frame = await (await page.waitForSelector('#f')).contentFrame();
  const ui = () => frame.evaluate(() => ({ ...globalThis.__pencil.ui, proposals: globalThis.__pencil.ui?.proposals?.map((p) => ({ id: p.id, title: p.title })), conflicts: globalThis.__pencil.ui?.conflicts }));
  const until = async (test, what, ms = 20_000) => { const t = Date.now(); for (;;) { const v = await ui().catch(() => null); if (v && test(v)) return v; if (Date.now() - t > ms) throw new Error(`timeout: ${what} — ${JSON.stringify(v)?.slice(0, 400)}`); await new Promise((r) => setTimeout(r, 150)); } };
  const nodes = async () => (await agent('inspect', { docId, depth: 4 })).nodes;
  const byName = async (name) => (await nodes()).find((x) => x.untrusted.name === name);
  const backend = async () => invoke('action', 'get', { docId });
  const human = (fn, arg) => frame.evaluate(fn, arg);

  await until((u) => u.docId === docId && u.proposals?.length === 1, 'frame lists the first proposal');
  step('frame loaded design and shows 1 pending proposal', { rev: (await ui()).rev });

  await frame.click('[data-testid="accept"]');
  const accepted = await until((u) => u.rev === 1 && !u.working, 'accept applied');
  assert.match(accepted.message, /Applied/);
  const hasLogin = await human(() => { const g = globalThis.__pencil.editor.graph; const page = g.getPages()[0]; return (g.getNode(page.id).childIds ?? []).some((id) => g.getNode(id)?.name === 'Login'); });
  assert.equal(hasLogin, true, 'the editor replica shows the accepted screen');
  await page.screenshot({ path: new URL('1-accepted.png', OUT).pathname });
  step('human clicked Accept → rev 1 in backend and editor', { message: accepted.message, editorHasLogin: hasLogin });

  // Agent proposes a recolor (base rev 1); human renames the title meanwhile → rebase.
  const button = await byName('Primary button'), title = await byName('Title');
  const recolor = await agent('propose', { docId, baseRev: 1, title: 'Green button', ops: [{ op: 'update', id: button.id, props: { fill: '#16A34A' } }] });
  await human((id) => globalThis.__pencil.editor.updateNodeWithUndo(id, { name: 'Heading' }), title.id);
  await until((u) => u.rev === 2 && u.proposals.some((p) => p.id === recolor.proposalId), 'human edit synced and recolor listed');
  assert.equal((await byName('Heading'))?.id, title.id, 'backend has the human rename');
  step('human edit synced from the editor', { backendRev: (await backend()).rev });
  await frame.click(`[data-proposal="${recolor.proposalId}"] [data-testid="accept"]`);
  const rebased = await until((u) => u.rev === 3 && !u.working, 'rebased accept');
  assert.match(rebased.message, /rebased onto your edits/);
  assert.equal((await byName('Heading'))?.id, title.id, 'human rename survived the agent batch');
  await page.screenshot({ path: new URL('2-rebased.png', OUT).pathname });
  step('stale proposal accepted with field-level rebase; human edit preserved', { message: rebased.message });

  // Conflict: agent and human both rename the title.
  const rename = await agent('propose', { docId, baseRev: 3, title: 'Agent title', ops: [{ op: 'update', id: title.id, props: { name: 'Agent Title' } }] });
  await human((id) => globalThis.__pencil.editor.updateNodeWithUndo(id, { name: 'Human Title' }), title.id);
  await until((u) => u.rev === 4 && u.proposals.some((p) => p.id === rename.proposalId), 'second human edit synced');
  await frame.click(`[data-proposal="${rename.proposalId}"] [data-testid="accept"]`);
  const conflicted = await until((u) => !u.working && u.conflicts?.length > 0, 'conflict shown');
  assert.equal((await byName('Human Title'))?.id, title.id, 'nothing applied on conflict');
  assert.equal((await backend()).rev, 4);
  await page.screenshot({ path: new URL('3-conflict.png', OUT).pathname });
  step('same-field conflict shown in the review panel; nothing applied', { message: conflicted.message, conflicts: conflicted.conflicts });

  // Lock from the editor toolbar; agent can no longer touch the button.
  await human((id) => globalThis.__pencil.editor.select([id]), button.id);
  await frame.click('[data-testid="lock"]');
  await until((u) => /Locked 1 layer/.test(u.message ?? '') && !u.working, 'lock applied');
  await assert.rejects(agent('propose', { docId, title: 'x', ops: [{ op: 'update', id: button.id, props: { radius: 0 } }] }), (e) => e.reason === 'node_locked');
  step('human locked the button from the toolbar; agent proposal refused (node_locked)');

  // Scope agent to a selection.
  const email = await byName('Email');
  await human((id) => globalThis.__pencil.editor.select([id]), email.id);
  await frame.click('[data-testid="scope"]');
  await until((u) => /only the 1 selected/.test(u.message ?? '') && !u.working, 'scope set');
  await assert.rejects(agent('propose', { docId, title: 'x', ops: [{ op: 'update', id: title.id, props: { name: 'Nope' } }] }), (e) => e.reason === 'out_of_scope');
  const scoped = await agent('propose', { docId, title: 'Rounder email', ops: [{ op: 'update', id: email.id, props: { radius: 20 } }] });
  await until((u) => u.proposals.some((p) => p.id === scoped.proposalId), 'scoped proposal listed');
  await frame.click(`[data-proposal="${scoped.proposalId}"] [data-testid="reject"]`);
  await until((u) => /Rejected/.test(u.message ?? '') && !u.proposals.some((p) => p.id === scoped.proposalId), 'reject');
  step('scope to selection enforced; scoped proposal rejected from the panel');

  await frame.click('[data-testid="save"]');
  const saved = await until((u) => /Saved designs\//.test(u.message ?? ''), 'save');
  const saveRec = (await backend());
  const onDisk = await readFile(join(cwd, saveRec.path));
  step('saved .fig from the toolbar', { message: saved.message, bytes: onDisk.length, savedRev: saveRec.savedRev, rev: saveRec.rev });
  await page.screenshot({ path: new URL('4-final.png', OUT).pathname });

  issues.violations = await frame.evaluate(() => globalThis.__csp ?? []);
  const hostLog = await page.evaluate(() => window.hostLog.map(([m]) => m));
  assert.deepEqual(issues.violations, []); assert.deepEqual(issues.pageErrors, []); assert.deepEqual(issues.external, []);
  step('no CSP violations, page errors or external requests', { hostMethods: [...new Set(hostLog)], actions: [...new Set(actionsSeen)] });
  await writeFile(new URL('report.json', OUT), JSON.stringify({ steps, issues }, null, 2));
  console.log('LOOP PASS');
} finally { await browser.close(); server.close(); await rt.dispose(); await rm(cwd, { recursive: true, force: true }); }
