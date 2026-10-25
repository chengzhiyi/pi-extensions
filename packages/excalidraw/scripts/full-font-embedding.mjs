// CSP policy: preserve the complete, already unicode-range-partitioned WOFF2 file.
// No Emscripten/Harfbuzz compilation or dynamic JS construction is needed.
export const a = {Subset: 'SUBSET'};
let announced = false;
export async function c(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 48 || view.getUint32(0) !== 0x774f4632 || view.getUint32(8) !== bytes.length) {
    throw new Error('CSP full-font embedding requires a valid WOFF2 header and exact file length');
  }
  if (!announced) {
    console.info('Excalidraw CSP: embedding complete WOFF2 font partitions (glyph subsetting disabled; glyphs preserved).');
    announced = true;
  }
  return buffer;
}
export async function d(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:font/woff2;base64,${btoa(binary)}`;
}
export async function b(buffer) { return d(await c(buffer)); }
