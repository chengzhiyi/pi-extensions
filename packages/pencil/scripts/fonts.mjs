// Build-time CJK font subsetter (harfbuzz-subset WASM, MIT). Noto Sans SC is OFL-1.1.
// Full Google Noto Sans SC TTFs are ~10.5 MB each, above the host's 8 MiB per-font cap, so we
// keep ASCII/Latin-1, CJK punctuation, kana, fullwidth forms, GB2312 hanzi and JIS level-1 kanji.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
export const CJK_WEIGHTS = [['Regular', '400Regular'], ['Medium', '500Medium'], ['Bold', '700Bold']];

export function cjkCodepoints() {
  const set = new Set();
  const range = (a, b) => { for (let c = a; c <= b; c++) set.add(c); };
  range(0x20, 0x7e); range(0xa0, 0xff); range(0x2000, 0x206f); range(0x2190, 0x21ff); range(0x2460, 0x24ff);
  range(0x3000, 0x303f); range(0x3040, 0x30ff); range(0x31f0, 0x31ff); range(0xff00, 0xffef);
  const decode = (label, lead, trail) => {
    const decoder = new TextDecoder(label, { fatal: false });
    for (let a = lead[0]; a <= lead[1]; a++) for (let b = trail[0]; b <= trail[1]; b++) {
      for (const ch of decoder.decode(new Uint8Array([a, b]))) { const cp = ch.codePointAt(0); if (cp >= 0x3400 && cp !== 0xfffd) set.add(cp); }
    }
  };
  decode('gb18030', [0xb0, 0xf7], [0xa1, 0xfe]);              // GB2312 levels 1+2 (6763 hanzi)
  decode('shift_jis', [0x88, 0x98], [0x40, 0xfc]);            // JIS X 0208 level 1 kanji
  return [...set].sort((a, b) => a - b);
}

async function hb() {
  const wasm = await readFile(join(dirname(require.resolve('harfbuzzjs')), 'harfbuzz-subset.wasm'));
  const { instance } = await WebAssembly.instantiate(wasm, { env: {}, wasi_snapshot_preview1: { proc_exit() {}, fd_write() { return 0; }, fd_close() { return 0; }, fd_seek() { return 0; } } });
  return instance.exports;
}

export async function subsetFont(bytes, codepoints) {
  const x = await hb();
  const heap = () => new Uint8Array(x.memory.buffer);
  const ptr = x.malloc(bytes.byteLength); heap().set(bytes, ptr);
  const blob = x.hb_blob_create(ptr, bytes.byteLength, 2 /* writable */, 0, 0);
  const face = x.hb_face_create(blob, 0);
  x.hb_blob_destroy(blob);
  const input = x.hb_subset_input_create_or_fail();
  const unicodes = x.hb_subset_input_unicode_set(input);
  for (const cp of codepoints) x.hb_set_add(unicodes, cp);
  const subset = x.hb_subset_or_fail(face, input);
  x.hb_subset_input_destroy(input);
  if (!subset) throw new Error('harfbuzz subset failed');
  const out = x.hb_face_reference_blob(subset);
  const data = x.hb_blob_get_data(out, 0), length = x.hb_blob_get_length(out);
  const result = heap().slice(data, data + length);
  x.hb_blob_destroy(out); x.free(ptr);
  return result;
}

/** Writes subset TTFs into `outDir`; cached by source+charset digest. Returns [{style, file, bytes}]. */
export async function buildCjkFonts(outDir) {
  await mkdir(outDir, { recursive: true });
  const codepoints = cjkCodepoints();
  const root = dirname(require.resolve('@expo-google-fonts/noto-sans-sc/package.json'));
  const files = [];
  for (const [style, dir] of CJK_WEIGHTS) {
    const source = await readFile(join(root, dir, `NotoSansSC_${dir}.ttf`));
    const key = createHash('sha256').update(source).update(String(codepoints.length)).digest('hex').slice(0, 12);
    const file = `NotoSansSC-${style}.ttf`, target = join(outDir, file), stamp = `${target}.${key}`;
    let bytes;
    try { await readFile(stamp); bytes = await readFile(target); }
    catch { bytes = await subsetFont(source, codepoints); await writeFile(target, bytes); await writeFile(stamp, ''); }
    files.push({ style, file, bytes: bytes.length, source: source.length });
  }
  return { codepoints: codepoints.length, files };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await buildCjkFonts(process.argv[2] ?? '.cache/fonts'), null, 2));
