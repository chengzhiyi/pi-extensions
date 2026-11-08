// Browser-side .fig I/O for the editor replica (snapshot sync; the Yjs replica is spike S6).
import { IORegistry, figFormat } from '@open-pencil/core/io';
import { computeAllLayouts } from '@open-pencil/core/layout';

const io = new IORegistry([figFormat]);
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); }

export async function loadFig(base64) {
  const { graph } = await io.readDocument({ name: 'design.fig', data: fromB64(base64) });
  graph.applyDerivedLayoutDuring(() => computeAllLayouts(graph));
  return graph;
}
export async function exportFig(graph) {
  const result = await io.writeDocument('fig', graph, { renderThumbnail: false });
  return toB64(result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data));
}

/** Document files a person can import (the backend reads them with OpenPencil's own readers). */
export const IMPORT_EXTENSIONS = ['fig', 'jam', 'pen', 'drawio', 'dio'];
export const IMPORT_ACCEPT = IMPORT_EXTENSIONS.map((e) => `.${e}`).join(',');
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
export const isImportable = (file) => IMPORT_EXTENSIONS.includes(String(file?.name).toLowerCase().split('.').pop());
