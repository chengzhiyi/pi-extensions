// Human–agent loop in a real browser: the built editor frame (per-plugin CSP) talks the hosted-v2
// handshake + MessagePort protocol to a parent page; its `action` calls reach the packaged backend
// runtime (in-memory broker with host semantics). Agent tool calls are issued from Node.
// Covers: agent changes applied onto the canvas with an undo toast, human edit sync, undo, locks, preview,
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) issues.external.push(r.url()); });
  page.on('pageerror', (e) => issues.pageErrors.push(String(e.message).slice(0, 300)));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => { (globalThis.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`); }));
  await page.goto(origin + '/');
  const frame = await (await page.waitForSelector('#f')).contentFrame();
  const ui = () => frame.evaluate(() => ({ ...globalThis.__pencil.ui, proposals: globalThis.__pencil.ui?.proposals?.map((p) => ({ id: p.id, title: p.title })), conflicts: globalThis.__pencil.ui?.conflicts, changes: globalThis.__pencil.ui?.changes?.map((c) => ({ ...c })), toast: globalThis.__pencil.ui?.toast ? { ...globalThis.__pencil.ui.toast } : null }));
  const until = async (test, what, ms = 20_000) => { const t = Date.now(); for (;;) { const v = await ui().catch(() => null); if (v && test(v)) return v; if (Date.now() - t > ms) throw new Error(`timeout: ${what} — ${JSON.stringify(v)?.slice(0, 400)}`); await new Promise((r) => setTimeout(r, 150)); } };
  await frame.waitForFunction(() => globalThis.__pencil?.ready === true, null, { timeout: 30_000 });

  // The agent's first design appears on the open, empty canvas by itself, with an undo toast.
  const first = await agent('apply', { title: 'Login screen', ops: LOGIN });
  const docId = first.docId;
  assert.equal(first.rev, 1);
  const nodes = async () => (await agent('inspect', { docId, depth: 4 })).nodes;
  const byName = async (name) => (await nodes()).find((x) => x.untrusted.name === name);
  const backend = async () => invoke('action', 'get', { docId });
  const human = (fn, arg) => frame.evaluate(fn, arg);
  const shown = await until((u) => u.docId === docId && u.rev === 1 && u.toast?.title === 'Login screen', 'agent design shown on the canvas');
  const canvas = await human(() => { const e = globalThis.__pencil.editor, g = e.graph, page = g.getPages()[0];
    return { login: (g.getNode(page.id).childIds ?? []).some((id) => g.getNode(id)?.name === 'Login'), selected: [...e.state.selectedIds].map((id) => g.getNode(id)?.name) }; });
  assert.deepEqual(canvas, { login: true, selected: ['Login'] }, 'the new screen is on the canvas and selected');
  assert.equal(await frame.locator('[data-testid="agent-toast"]').isVisible(), true);
  assert.equal(shown.proposals.length, 0, 'nothing waits for review');
  await page.screenshot({ path: new URL('1-applied.png', OUT).pathname });
  step('agent change applied straight onto the canvas (selected, toast with Undo)', { rev: shown.rev });

  // A person's edit syncs and retires the toast: the agent change is no longer the one to undo.
  const button = await byName('Primary button'), title = await byName('Title');
  await human((id) => globalThis.__pencil.editor.updateNodeWithUndo(id, { name: 'Human Title' }), title.id);
  await until((u) => u.rev === 2 && !u.toast, 'human edit synced, toast gone');
  assert.equal((await byName('Human Title'))?.id, title.id, 'backend has the human rename');
  step('human edit synced from the editor', { backendRev: (await backend()).rev });

  // The agent recolors the button; the person undoes it from the canvas toast.
  await agent('apply', { docId, baseRev: 2, title: 'Green button', ops: [{ op: 'update', id: button.id, props: { fill: '#16A34A' } }] });
  await until((u) => u.rev === 3 && u.toast?.title === 'Green button', 'recolor shown');
  const fill = () => human((id) => { const f = globalThis.__pencil.editor.graph.getNode(id)?.fills?.[0]?.color; return f ? [f.r, f.g, f.b].map((c) => Math.round(c * 255)).join(',') : null; }, button.id);
  assert.equal(await fill(), '22,163,74', 'the editor shows the agent recolor');
  await frame.click('[data-testid="agent-undo"]');
  const undone = await until((u) => u.rev === 4 && !u.working && !u.toast, 'undo applied');
  assert.match(undone.message, /Undid|撤销/);
  assert.notEqual(await fill(), '22,163,74', 'recolor undone in the editor');
  assert.equal((await byName('Human Title'))?.id, title.id, 'the human rename survived the undo');
  assert.deepEqual(undone.changes.map((c) => [c.title, c.reverted]), [['Green button', true], ['Login screen', false]]);
  await page.screenshot({ path: new URL('2-undone.png', OUT).pathname });
  step('agent change undone from the canvas toast; human edit preserved', { message: undone.message });

  // Lock from the Agent tab; the agent can no longer touch the button.
  await frame.click('[data-testid="tab-review"]');
  await human((id) => globalThis.__pencil.editor.select([id]), button.id);
  await frame.click('[data-testid="lock"]');
  await until((u) => /Locked 1 layer/.test(u.message ?? '') && !u.working, 'lock applied');
  await assert.rejects(agent('apply', { docId, title: 'x', ops: [{ op: 'update', id: button.id, props: { radius: 0 } }] }), (e) => e.reason === 'node_locked');
  step('human locked the button; agent change refused (node_locked)');

  // Scope agent to a selection.
  const email = await byName('Email');
  await human((id) => globalThis.__pencil.editor.select([id]), email.id);
  await frame.click('[data-testid="scope"]');
  await until((u) => /only the 1 selected/.test(u.message ?? '') && !u.working, 'scope set');
  await assert.rejects(agent('apply', { docId, title: 'x', ops: [{ op: 'update', id: title.id, props: { name: 'Nope' } }] }), (e) => e.reason === 'out_of_scope');
  const scoped = await agent('apply', { docId, title: 'Rounder email', ops: [{ op: 'update', id: email.id, props: { radius: 20 } }] });
  await until((u) => u.rev === scoped.rev && u.changes?.[0]?.title === 'Rounder email', 'scoped change shown');
  assert.equal(await frame.locator('[data-testid="changes"] li').first().locator('[data-testid="undo"]').isVisible(), true, 'the Agent tab offers undo for the latest change');
  await frame.click('[data-testid="unscope"]');
  await until((u) => /whole design|整个设计/.test(u.message ?? '') && !u.working, 'scope lifted');
  const lifted = await agent('apply', { docId, title: 'Note', ops: [{ op: 'create', ref: '$note', parent: '$page', type: 'TEXT', props: { x: -600, y: -200, text: { content: 'note' } } }] });
  assert.equal(lifted.status, 'applied', '"Whole design" gives the agent the page again');
  await until((u) => u.rev === lifted.rev && !u.working, 'note shown'); // the editor selects fresh agent changes: let it settle first
  step('scope to selection enforced; scoped change applied and listed; lifting the limit restores the whole design');


  await frame.click('[data-testid="save"]');
  const saved = await until((u) => /Saved designs\//.test(u.message ?? ''), 'save');
  const saveRec = (await backend());
  const onDisk = await readFile(join(cwd, saveRec.path));
  step('saved .fig from the toolbar', { message: saved.message, bytes: onDisk.length, savedRev: saveRec.savedRev, rev: saveRec.rev });
  await page.screenshot({ path: new URL('4-final.png', OUT).pathname });

  // Theme and language follow the host: initialize said light + zh, then the host changes both.
  const look = () => frame.evaluate(() => ({ theme: document.documentElement.dataset.theme, lang: document.documentElement.lang, design: document.querySelector('[data-testid="tab-design"]')?.textContent.trim() }));
  assert.deepEqual(await look(), { theme: 'light', lang: 'zh-CN', design: '设计' });
  await page.evaluate(() => window.hostCall('update', { theme: 'dark', locale: 'en' }));
  await frame.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.documentElement.lang === 'en');
  assert.equal((await look()).design, 'Design');
  step('theme and language follow the host', await look());

  // Text editing keeps the editor in place (the SDK's hidden input is Tailwind-styled upstream).
  const heading = await byName('Human Title');
  await human((id) => globalThis.__pencil.editor.startTextEditing(id), heading.id);
  await frame.waitForSelector('textarea[data-canvas-text-input]', { state: 'attached' });
  const edit = await frame.evaluate(() => { const ta = document.querySelector('textarea[data-canvas-text-input]'), cs = getComputedStyle(ta);
    return { position: cs.position, opacity: cs.opacity, scroll: document.scrollingElement.scrollTop, shellTop: document.querySelector('.op-shell').getBoundingClientRect().top }; });
  assert.deepEqual(edit, { position: 'fixed', opacity: '0', scroll: 0, shellTop: 0 });
  await page.keyboard.press('Escape');
  step('text editing does not move the editor', edit);

  // Code tab: the selection as React + Tailwind, regenerated by OpenPencil's own code formats.
  await human((id) => globalThis.__pencil.editor.select([id]), button.id);
  await frame.click('[data-testid="tab-code"]');
  await frame.waitForFunction(() => /className=/.test(document.querySelector('[data-testid="code"]')?.textContent ?? ''));
  await frame.selectOption('[data-testid="code-format"]', 'html');
  await frame.waitForFunction(() => /<div|<button|<span/.test(document.querySelector('[data-testid="code"]')?.textContent ?? '') && !/className=/.test(document.querySelector('[data-testid="code"]').textContent));
  step('Code tab generates Tailwind JSX and HTML for the selection');

  // Inspect tab: OpenPencil's recommended design-check rules over the page.
  await frame.click('[data-testid="tab-inspect"]');
  await frame.waitForSelector('[data-testid="inspect-panel"] .op-lint-counts');
  const findings = await frame.locator('[data-testid="lint-item"]').count();
  step('Inspect tab runs the design check', { findings });

  // Export: add a PNG setting to the selection and export it through the host's download relay.
  await frame.click('[data-testid="tab-design"]');
  await frame.click('[data-testid="export-add"]');
  await frame.click('[data-testid="export-run"]');
  const download = await page.waitForFunction(() => { const d = window.hostLog.find(([m]) => m === 'downloadDrawing'); return d && { name: d[1].name, type: d[1].blob.type, size: d[1].blob.size }; });
  const file = await download.jsonValue();
  assert.equal(file.name, 'Primary button.png'); assert.equal(file.type, 'image/png'); assert.ok(file.size > 100);
  step('Export downloads the selection as PNG through the host', file);
  await page.screenshot({ path: new URL('5-panels.png', OUT).pathname });

  // Preview is OpenPencil's play view on the canvas: the editing UI goes away, it keeps the host theme (dark by
  // now), and instances of components with a behaviour run as live controls. The agent builds a switch the way
  // its read_me teaches (two variants + switch behaviour) and places it in the screen.
  await frame.evaluate(() => globalThis.__pencil.flush()); // let the person's last edit (export setting) sync first
  const readMe = await agent('reference', {});
  const screenNode = await byName('Login');
  const built = await agent('apply', { docId, title: 'Wi-Fi switch', ops: readMe.interactiveExample.ops.map((o) => o.ref === '$wifi' ? { ...o, parent: screenNode.id } : o) });
  await until((u) => u.rev === built.rev && !u.working, 'agent switch shown');
  assert.deepEqual(await human(() => { const e = globalThis.__pencil.editor; return [...e.state.selectedIds].map((id) => e.graph.getNode(id)?.name); }), ['Login'],
    'the editor shows the screen the switch went into, not its hidden source variants');
  await frame.click('[data-testid="present"]');
  await frame.waitForSelector('[data-testid="play-bar"]');
  const preview = await frame.waitForFunction(() => {
    const islands = [...document.querySelectorAll("[data-test-id='play-islands'] > div > *")];
    const control = islands.map((el) => el.shadowRoot?.querySelector('[role="switch"]')).find(Boolean);
    if (!control || [...document.fonts].some((f) => f.status === 'loading')) return null;
    const color = (value) => { const el = document.createElement('span'); el.style.color = value; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; };
    const root = getComputedStyle(document.documentElement);
    return { view: globalThis.__pencil.editor.state.canvasView.id, islands: islands.length, control: control.getAttribute('role'), checked: control.getAttribute('aria-checked'),
      leftHidden: getComputedStyle(document.querySelector('[data-testid="left-panel"]')).display === 'none',
      fonts: ['Noto Sans SC', 'Inter'].map((family) => [...document.fonts].some((f) => f.family.replace(/"/g, '') === family && f.status === 'loaded')),
      barFollowsTheme: getComputedStyle(document.querySelector('[data-testid="play-bar"]')).backgroundColor === color(root.getPropertyValue('--color-panel').trim()),
      theme: document.documentElement.dataset.theme };
  }, null, { timeout: 20_000 }).then((h) => h.jsonValue());
  assert.deepEqual(preview, { view: 'play', islands: 1, control: 'switch', checked: 'false', leftHidden: true, fonts: [true, true], barFollowsTheme: true, theme: 'dark' });
  // The live switch takes the pointer and flips; the editor does not (no selection, no edits while previewing).
  const before = await frame.evaluate(() => globalThis.__pencil.ui.rev);
  const box = await frame.evaluate(() => { const el = [...document.querySelectorAll("[data-test-id='play-islands'] > div > *")].map((e) => e.shadowRoot?.querySelector('[role="switch"]')).find(Boolean); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const offset = await page.evaluate(() => { const r = document.querySelector('#f').getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await page.mouse.click(offset.x + box.x, offset.y + box.y);
  await frame.waitForFunction(() => [...document.querySelectorAll("[data-test-id='play-islands'] > div > *")].map((el) => el.shadowRoot?.querySelector('[role="switch"]')).find(Boolean)?.getAttribute('aria-checked') === 'true');
  await page.keyboard.press('Delete'); // the screen is still selected from the agent's change: it must survive
  await new Promise((r) => setTimeout(r, 1200)); // past the 800 ms sync debounce
  assert.equal(await human(() => [...(globalThis.__pencil.editor.graph.getAllNodes?.() ?? globalThis.__pencil.editor.graph.nodes.values())].some((n) => n.name === 'Login')), true, 'keys do not edit the design while previewing');
  assert.equal(await frame.evaluate(() => globalThis.__pencil.ui.rev), before, 'nothing synced while previewing');
  await page.screenshot({ path: new URL('6-preview.png', OUT).pathname });
  await frame.click('[data-testid="play-reset"]');
  assert.equal(await frame.evaluate(() => globalThis.__pencil.editor.state.canvasView.id), 'play', 'Reset restarts the controls and stays in preview');
  await frame.waitForFunction(() => [...document.querySelectorAll("[data-test-id='play-islands'] > div > *")].map((el) => el.shadowRoot?.querySelector('[role="switch"]')).find(Boolean)?.getAttribute('aria-checked') === 'false');
  await page.keyboard.press('Escape');
  await frame.waitForSelector('[data-testid="play-bar"]', { state: 'detached' });
  assert.equal(await frame.locator('[data-testid="left-panel"]').isVisible(), true, 'Esc returns to the editor');
  assert.equal(await frame.evaluate(() => globalThis.__pencil.ui.rev) >= before, true);
  step('agent-built switch runs live in Preview (click turns it on, Reset turns it off) in the host theme; Esc leaves', { ...preview, afterClick: 'true' });

  issues.violations = await frame.evaluate(() => globalThis.__csp ?? []);
  const hostLog = await page.evaluate(() => window.hostLog.map(([m]) => m));
  assert.deepEqual(issues.violations, []); assert.deepEqual(issues.pageErrors, []); assert.deepEqual(issues.external, []);
  step('no CSP violations, page errors or external requests', { hostMethods: [...new Set(hostLog)], actions: [...new Set(actionsSeen)] });
  await writeFile(new URL('report.json', OUT), JSON.stringify({ steps, issues }, null, 2));
  console.log('LOOP PASS');
} finally { await browser.close(); server.close(); await rt.dispose(); await rm(cwd, { recursive: true, force: true }); }
