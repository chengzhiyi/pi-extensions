// Spike S2/S3/S4 (backend half): run @open-pencil/core headlessly under plain Node, with network
// denied, build an auto-layout login screen through the typed Figma API (no eval), lay it out with
// Yoga, render PNG with CanvasKit, save .fig, reload it in a fresh registry, compare, check CJK.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
import { buildCjkFonts } from './fonts.mjs';
import { buildLoginScreen, loadFixtureFonts, layoutSnapshot } from '../src/adapter/fixture.js';

const OUT = new URL('../.cache/probe/', import.meta.url);
await mkdir(OUT, { recursive: true });
const network = [];
const deny = (what) => (...args) => { network.push(`${what} ${String(args[0]?.href ?? args[0]?.host ?? args[0])}`); throw new Error(`network denied: ${what}`); };
globalThis.fetch = (async (url) => { if (String(url).startsWith('file:')) return realFetch(url); return deny('fetch')(url); });
const realFetch = async (url) => new Response(await readFile(new URL(String(url))));
http.request = deny('http'); https.request = deny('https'); http.get = deny('http'); https.get = deny('https'); net.connect = deny('net'); net.createConnection = deny('net');

const t0 = performance.now();
const { SceneGraph } = await import('@open-pencil/scene-graph');
const { FigmaAPI } = await import('@open-pencil/core/figma-api');
const raster = await import('@open-pencil/core/io/formats/raster');
const { computeAllLayouts, installTextMeasurer } = await import('@open-pencil/core/layout');
const text = await import('@open-pencil/core/text');
const { BUILTIN_IO_FORMATS, IORegistry } = await import('@open-pencil/core/io');
const timings = { import: Math.round(performance.now() - t0) };

// Offline fonts: disable every online provider, serve our CJK subset as a host font.
text.fontManager.setOnlineFontProviders(Object.fromEntries(text.WEB_FONT_PROVIDER_IDS.map((id) => [id, false])));
const fonts = await buildCjkFonts(new URL('../.cache/fonts/', import.meta.url).pathname);
const cjk = new Map();
for (const f of fonts.files) cjk.set(f.style, (await readFile(new URL(`../.cache/fonts/${f.file}`, import.meta.url))).buffer);
const CJK_FAMILY = 'Noto Sans SC';
const hostRequests = [];
text.fontManager.setHostFontLoader(async (family, style) => {
  hostRequests.push(`${family}|${style}`);
  if (family !== CJK_FAMILY && !/Noto Sans CJK|Source Han|PingFang|Hiragino|Microsoft YaHei|WenQuanYi/i.test(family)) return null;
  const buffer = cjk.get(style) ?? cjk.get(/bold/i.test(style) ? 'Bold' : /medium|semi/i.test(style) ? 'Medium' : 'Regular');
  return buffer ? buffer.slice(0) : null;
});
text.fontManager.setCJKFallbackFamily(CJK_FAMILY);

const t1 = performance.now();
const renderer = await raster.headlessRenderer();
installTextMeasurer((node, maxWidth) => renderer.measureTextNode(node, maxWidth));
text.installTextInkMeasurer?.((node) => renderer.measureTextInk(node)); // HEAD-only API, absent in 0.17.0-beta.2
timings.canvaskit = Math.round(performance.now() - t1);

async function figmaFor(graph) {
  const figma = new FigmaAPI(graph);
  renderer.nodePaths.clear(); renderer.invalidateAllPictures();
  figma.setRenderer(renderer);
  figma.exportImage = (ids, o) => raster.headlessRenderNodes(graph, o.pageId ?? figma.currentPageId, ids, o);
  figma.rasterCodec = raster.createCanvasKitRasterCodec(await raster.initCanvasKit());
  return figma;
}

// ---- S2: auto-layout screen via the typed Plugin API (what PencilOp → adapter will emit) ----
const graph = new SceneGraph();
const figma = await figmaFor(graph);
const t2 = performance.now();
await loadFixtureFonts(figma);
const screen = buildLoginScreen(figma);
const [title, subtitle, email, password, button, forgot] = screen.children;
computeAllLayouts(graph);
timings.build = Math.round(performance.now() - t2);

const node = (n) => graph.getNode(n.id);
const box = (n) => { const s = node(n); return { x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, w: Math.round(s.width * 10) / 10, h: Math.round(s.height * 10) / 10 }; };
const layoutReport = {
  screen: { ...box(screen), layoutMode: node(screen).layoutMode, itemSpacing: node(screen).itemSpacing, padding: [node(screen).paddingTop, node(screen).paddingRight, node(screen).paddingBottom, node(screen).paddingLeft] },
  children: [title, subtitle, email, password, button, forgot].map((n) => ({ name: node(n).name, ...box(n), sizingH: n.layoutSizingHorizontal })),
};
const kids = layoutReport.children;
const overlaps = kids.some((a, i) => kids.slice(i + 1).some((b) => a.y < b.y + b.h && b.y < a.y + a.h));
const gapsOk = kids.slice(1).every((b, i) => Math.abs(b.y - (kids[i].y + kids[i].h) - 16) < 0.6);
const fillOk = [subtitle, email, password, button].every((n) => Math.abs(box(n).w - (390 - 48)) < 0.6);

const t3 = performance.now();
const png1 = await raster.headlessRenderNodes(graph, figma.currentPageId, [screen.id], { scale: 2 });
timings.render = Math.round(performance.now() - t3);
await writeFile(new URL('login.png', OUT), png1);

// ---- S4: glyph coverage for every CJK character we drew ----
const ck = await raster.initCanvasKit();
const subsetBytes = new Uint8Array(cjk.get('Regular'));
const typeface = ck.Typeface.MakeTypefaceFromData(subsetBytes.buffer.slice(0));
const cjkText = '登录ログイン欢迎回来请输入账号信息邮箱密码忘记？／，。';
const glyphs = typeface.getGlyphIDs(cjkText);
const missing = [...cjkText].filter((_, i) => glyphs[i] === 0);
const missingInDoc = text.missingGlyphCharacters ? await Promise.resolve().then(() => null) : null;

// ---- S3: .fig save → reload in a fresh registry → projection + pixel comparison ----
const io = new IORegistry(BUILTIN_IO_FORMATS);
const t4 = performance.now();
const written = await io.writeDocument('fig', graph, { renderThumbnail: true });
timings.saveFig = Math.round(performance.now() - t4);
const figBytes = written.data instanceof Uint8Array ? written.data : new Uint8Array(written.data);
await writeFile(new URL('login.fig', OUT), figBytes);
const t5 = performance.now();
const reread = await new IORegistry(BUILTIN_IO_FORMATS).readDocument({ name: 'login.fig', data: new Uint8Array(await readFile(new URL('login.fig', OUT))) });
const g2 = reread.graph; g2.applyDerivedLayoutDuring(() => computeAllLayouts(g2));
timings.loadFig = Math.round(performance.now() - t5);
const project = (g) => {
  const rows = [];
  const walk = (id, depth) => { const n = g.getNode(id); if (!n) return;
    if (n.type !== 'CANVAS' && n.type !== 'DOCUMENT') rows.push([depth, n.type, n.name, Math.round(n.width), Math.round(n.height), Math.round(n.x), Math.round(n.y), n.layoutMode ?? '', n.itemSpacing ?? '', n.text ?? n.characters ?? '', n.fontFamily ?? ''].join('|'));
    for (const c of n.childIds ?? []) walk(c, depth + 1); };
  for (const page of g.getPages()) walk(page.id, 0);
  return rows;
};
const a = project(graph), b = project(g2);
const page2 = g2.getPages()[0];
const screen2 = [...g2.getChildren?.(page2.id) ?? page2.childIds.map((id) => g2.getNode(id))].find((n) => n.name === 'Login');
await figmaFor(g2);
const png2 = await raster.headlessRenderNodes(g2, page2.id, [screen2.id], { scale: 2 });
await writeFile(new URL('login-reloaded.png', OUT), png2);
const cmp = raster.comparePNGs ? await raster.comparePNGs(raster.createCanvasKitRasterCodec(ck), png1, png2) : null;

await writeFile(new URL('layout-node.json', OUT), JSON.stringify(layoutSnapshot(graph, screen.id), null, 2));
const report = {
  node: process.version, timings, network, hostFontRequests: [...new Set(hostRequests)],
  fonts, layout: layoutReport, checks: { overlaps, gapsOk, fillOk, cjkMissingGlyphs: missing, figBytes: figBytes.length, projectionEqual: JSON.stringify(a) === JSON.stringify(b), projectionDiff: a.filter((r, i) => r !== b[i]).slice(0, 10).map((r, i) => [r, b[a.indexOf(r)]]), pixel: cmp },
  rows: a,
};
await writeFile(new URL('report.json', OUT), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
void missingInDoc;
