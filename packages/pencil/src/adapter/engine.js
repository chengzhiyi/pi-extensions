// The ONLY place (with ops.js/fixture.js) that imports @open-pencil/*. Headless engine for the
// plugin backend: offline fonts, CanvasKit renderer, .fig I/O, layout, PNG render.
import { readFile } from 'node:fs/promises';
import { SceneGraph } from '@open-pencil/scene-graph';
import { FigmaAPI } from '@open-pencil/core/figma-api';
import { setCanvasKitLocator } from '@open-pencil/core/canvaskit';
import * as raster from '@open-pencil/core/io/formats/raster';
import { computeAllLayouts, installTextMeasurer } from '@open-pencil/core/layout';
import { fontManager, WEB_FONT_PROVIDER_IDS, setHarfBuzzSubsetLocator } from '@open-pencil/core/text';
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io';

export const CJK_FAMILY = 'Noto Sans SC';
const CJK_FILES = { Regular: 'NotoSansSC-Regular.ttf', Medium: 'NotoSansSC-Medium.ttf', Bold: 'NotoSansSC-Bold.ttf' };

let ready = null;
/** `assetsDir` is a file: URL string ending in '/', holding canvaskit/, fonts/ and harfbuzz files. */
export function initEngine(assetsDir) {
  ready ??= (async () => {
    const asset = (name) => new URL(name, assetsDir).href;
    setCanvasKitLocator((file) => asset(file));
    setHarfBuzzSubsetLocator(() => asset('harfbuzz-subset.wasm'));
    fontManager.setBundledFontLocator((file) => asset(file));
    fontManager.setOnlineFontProviders(Object.fromEntries(WEB_FONT_PROVIDER_IDS.map((id) => [id, false])));
    const cache = new Map();
    fontManager.setHostFontLoader(async (family, style) => {
      if (family !== CJK_FAMILY && !/Noto Sans CJK|Source Han|PingFang|Hiragino|Microsoft YaHei|WenQuanYi/i.test(family)) return null;
      const key = CJK_FILES[style] ? style : /bold/i.test(style) ? 'Bold' : /medium|semi/i.test(style) ? 'Medium' : 'Regular';
      if (!cache.has(key)) cache.set(key, readFile(new URL(CJK_FILES[key], assetsDir)).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
      return (await cache.get(key)).slice(0);
    });
    fontManager.setCJKFallbackFamily(CJK_FAMILY);
    const renderer = await raster.headlessRenderer();
    installTextMeasurer((node, maxWidth) => renderer.measureTextNode(node, maxWidth));
    return { renderer, ck: await raster.initCanvasKit() };
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

export async function figmaFor(graph) {
  const { renderer, ck } = await ready;
  const figma = new FigmaAPI(graph);
  renderer.nodePaths.clear(); renderer.invalidateAllPictures();
  figma.setRenderer(renderer);
  figma.exportImage = (ids, o) => raster.headlessRenderNodes(graph, o.pageId ?? figma.currentPageId, ids, o);
  figma.rasterCodec = raster.createCanvasKitRasterCodec(ck);
  return figma;
}

export function newGraph() { return new SceneGraph(); }

export async function readFig(bytes) {
  const { graph } = await new IORegistry(BUILTIN_IO_FORMATS).readDocument({ name: 'design.fig', data: bytes });
  graph.applyDerivedLayoutDuring(() => computeAllLayouts(graph));
  return graph;
}

export async function writeFig(graph) {
  const result = await new IORegistry(BUILTIN_IO_FORMATS).writeDocument('fig', graph, { renderThumbnail: true });
  return result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
}

export function layout(graph) { computeAllLayouts(graph); }

export async function renderPng(graph, nodeId, { scale = 1, maxEdge = 1600 } = {}) {
  const node = graph.getNode(nodeId);
  if (!node) throw Object.assign(new Error(`Unknown node ${nodeId}`), { status: 404 });
  const page = pageOf(graph, nodeId);
  const s = Math.min(scale, maxEdge / Math.max(node.width, node.height, 1));
  return raster.headlessRenderNodes(graph, page, [nodeId], { scale: s, format: 'PNG' });
}

export function pageOf(graph, id) {
  let n = graph.getNode(id);
  while (n && n.type !== 'CANVAS') n = n.parentId ? graph.getNode(n.parentId) : null;
  return n?.id ?? graph.getPages()[0].id;
}

/** Compact projection for the agent. Design-derived strings go under `untrusted`. */
export function project(graph, rootId, depth = 3, cap = 200) {
  const out = [];
  const walk = (id, d) => {
    const n = graph.getNode(id); if (!n || out.length >= 400) return;
    const row = { id: n.id, type: n.type, x: r(n.x), y: r(n.y), w: r(n.width), h: r(n.height), parent: n.parentId ?? null,
      locked: !!n.locked, layout: n.layoutMode && n.layoutMode !== 'NONE' ? { mode: n.layoutMode, gap: n.itemSpacing, padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] } : undefined,
      untrusted: { name: String(n.name ?? '').slice(0, cap), ...(n.type === 'TEXT' ? { text: String(n.text ?? '').slice(0, cap) } : {}) } };
    out.push(row);
    if (d < depth) for (const c of n.childIds ?? []) walk(c, d + 1);
  };
  walk(rootId, 0);
  return out;
}
const r = (v) => Math.round((v ?? 0) * 10) / 10;
