// Browser-side .fig I/O for the editor replica (snapshot sync; the Yjs replica is spike S6).
import { IORegistry, figFormat } from '@open-pencil/core/io';
import { computeAllLayouts } from '@open-pencil/core/layout';

const io = new IORegistry([figFormat]);
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); }

export async function loadFig(base64) {
  const { graph } = await io.readDocument({ name: 'design.fig', data: fromB64(base64) });
  graph.applyDerivedLayoutDuring(() => computeAllLayouts(graph));
  return graph;
}
export async function exportFig(graph) {
  const result = await io.writeDocument('fig', graph, { renderThumbnail: false });
  return toB64(result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data));
}
