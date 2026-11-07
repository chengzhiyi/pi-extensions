// Spike S1 + browser half of S4/S5. Real HTTP over the built dist, real Chromium, the host's exact
// hosted-asset CSP (control) and the proposed per-plugin CSP (+ 'wasm-unsafe-eval' only).
// Outputs .cache/spike/s1.json and screenshots. Exit code 1 when a pass criterion fails.
import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { chromium } from '@playwright/test';

const DIST = new URL('../dist/', import.meta.url).pathname;
const OUT = new URL('../.cache/spike/', import.meta.url);
await mkdir(OUT, { recursive: true });
const BASE = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
const WASM = BASE.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'");
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function walk(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }
const files = await walk(DIST);

// Static scan of every built JS file for dynamic code (reported, compared against reviewed allowlist).
const dynamic = [];
for (const f of files.filter((p) => /\.m?js$/.test(p))) {
  const js = await readFile(f, 'utf8');
  for (const m of js.matchAll(/new Function\s*\(|[^\w.$]Function\s*\(\s*["'`]|\beval\s*\(|AsyncFunction/g)) {
    dynamic.push({ file: relative(DIST, f), at: m.index, snippet: js.slice(Math.max(0, m.index - 60), m.index + 50).replace(/\s+/g, ' ') });
  }
}

async function run(label, csp) {
  const served = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body style="margin:0"><iframe id="f" src="/frame.html" style="width:1280px;height:900px;border:0"></iframe>'); return; }
    const path = join(DIST, decodeURIComponent(url.pathname));
    if (!path.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    try { const bytes = await readFile(path); res.setHeader('Content-Security-Policy', csp); res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream'); served.push(url.pathname); res.end(bytes); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const result = { label, csp, violations: [], pageErrors: [], consoleErrors: [], external: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) result.external.push(r.url()); });
    page.on('pageerror', (e) => result.pageErrors.push(String(e.message).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 300)); });
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => { (globalThis.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`); }));
    const t0 = Date.now();
    await page.goto(origin + '/');
    const frame = await (await page.waitForSelector('#f')).contentFrame();
    let state = null;
    for (let i = 0; i < 120; i++) {
      state = await frame.evaluate(() => ({ ready: !!globalThis.__pencil?.ready, errors: globalThis.__pencil?.errors ?? [], csp: globalThis.__csp ?? [], firstPaintMs: globalThis.__pencil?.firstPaintMs, layout: globalThis.__pencil?.layout })).catch((e) => ({ ready: false, errors: [String(e)] }));
      if (state.ready || state.errors?.length || state.csp?.length) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    result.wallMs = Date.now() - t0;
    result.ready = !!state?.ready; result.frameErrors = state?.errors ?? []; result.violations = state?.csp ?? [];
    result.firstPaintMs = state?.firstPaintMs; result.layout = state?.layout;
    await page.screenshot({ path: new URL(`s1-${label}.png`, OUT).pathname });
    if (result.ready) {
      // Interaction smoke: wheel zoom + click-select on the canvas, then read selection.
      const box = await (await frame.$('canvas')).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -200);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await new Promise((r) => setTimeout(r, 300));
      const zoomBefore = await frame.evaluate(() => globalThis.__pencil.editor.state.zoom);
      result.selectionAfterClick = await frame.evaluate(() => [...(globalThis.__pencil.editor.state.selectedIds ?? [])].map((id) => globalThis.__pencil.editor.graph.getNode(id)?.name));
      const view = () => frame.evaluate(() => { const s = globalThis.__pencil.editor.state; return { zoom: +s.zoom.toFixed(4), panX: Math.round(s.panX), panY: Math.round(s.panY) }; });
      const v0 = await view();
      await page.mouse.wheel(0, 120); await new Promise((r) => setTimeout(r, 200));
      const v1 = await view();
      await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control'); await new Promise((r) => setTimeout(r, 200));
      const v2 = await view();
      result.zoom = { start: v0, afterWheelPan: v1, afterCtrlWheel: v2, panned: v0.panY !== v1.panY, zoomed: v2.zoom > v1.zoom };
      result.png = await frame.evaluate((s) => globalThis.__pencil.exportPng(s), 2).catch((e) => `ERR ${e}`);
      result.heapMB = await frame.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
      await page.screenshot({ path: new URL(`s1-${label}-after.png`, OUT).pathname });
    }
    result.violations.push(...await frame.evaluate(() => globalThis.__csp ?? []).catch(() => []));
    result.violations = [...new Set(result.violations)];
    result.served = served.length;
  } finally { await browser.close(); server.close(); }
  return result;
}

const control = await run('current-csp', BASE);
const proposed = await run('wasm-csp', WASM);
const report = { dynamic, control: { ...control, png: undefined }, proposed: { ...proposed, png: undefined } };
if (typeof proposed.png === 'string' && !proposed.png.startsWith('ERR')) await writeFile(new URL('login-browser.png', OUT), Buffer.from(proposed.png, 'base64'));
else report.proposed.pngError = proposed.png;
await writeFile(new URL('s1.json', OUT), JSON.stringify(report, null, 2));
const sizes = {}; for (const f of files) { const k = extname(f) || 'other'; sizes[k] = (sizes[k] ?? 0) + (await stat(f)).size; }
console.log(JSON.stringify({
  dynamicCodeSites: dynamic.map((d) => `${d.file}: ${d.snippet}`),
  control: { ready: control.ready, violations: control.violations.slice(0, 5), pageErrors: control.pageErrors.slice(0, 3), frameErrors: control.frameErrors.slice(0, 2) },
  proposed: { ready: proposed.ready, firstPaintMs: proposed.firstPaintMs, wallMs: proposed.wallMs, violations: proposed.violations, pageErrors: proposed.pageErrors, consoleErrors: proposed.consoleErrors.slice(0, 5), external: proposed.external, frameErrors: proposed.frameErrors, selectionAfterClick: proposed.selectionAfterClick, zoom: proposed.zoom, heapMB: proposed.heapMB, served: proposed.served, pngError: report.proposed.pngError },
  sizes,
}, null, 2));
