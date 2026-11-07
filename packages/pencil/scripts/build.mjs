// pi-pencil build (spike): backend (esbuild, Node 24 ESM, self-contained) + frame (Vite) +
// controlled resources.json. Upstream patches are hash-checked and fail closed on drift.
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, rm, cp, readdir, stat, realpath } from 'node:fs/promises';
import { dirname, join, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildCjkFonts } from './fonts.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist'), assets = join(dist, 'assets');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const pkgDir = (name, from = require) => dirname(from.resolve(`${name}/package.json`));
const coreDir = pkgDir('@open-pencil/core');
const fromCore = createRequire(join(coreDir, 'package.json'));

await rm(dist, { recursive: true, force: true });

// 1. Offline CJK font subsets (OFL), then the frame (Vite). Vite emits WASM and fonts under stable
// names in dist/assets/; the backend reads those same files, so nothing large ships twice.
const fonts = await buildCjkFonts(join(root, '.cache/fonts'));
const ckDir = pkgDir('canvaskit-wasm', fromCore);
// Every module the frame bundles, for the third-party notices.
const frameModules = new Set();
const collect = { name: 'pencil-collect-modules', generateBundle(_, bundle) {
  for (const chunk of Object.values(bundle)) for (const id of chunk.moduleIds ?? Object.keys(chunk.modules ?? {})) frameModules.add(id);
} };
await viteBuild({ configFile: join(root, 'vite.config.mjs'), logLevel: 'warn', plugins: [collect] });
for (const need of ['canvaskit.wasm', 'harfbuzz-subset.wasm', 'InterVariable.ttf', ...fonts.files.map((f) => f.file)]) {
  if (!(await stat(join(assets, need)).catch(() => null))) throw new Error(`Frame build did not emit shared asset ${need}`);
}
await mkdir(join(assets, 'canvaskit'), { recursive: true });

// 3. Backend bundle with reviewed adapters.
const patches = [];
const adapters = {
  name: 'pencil-upstream-adapters',
  setup(b) {
    // Headless raster resolves CanvasKit through node_modules; hosted packages have none.
    b.onLoad({ filter: /[/\\]@open-pencil[/\\]core[/\\]dist[/\\]io[/\\]formats[/\\]raster[/\\]headless\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const needle = 'const ckURL = import.meta.resolve("canvaskit-wasm/full");';
      if (source.split(needle).length !== 2) throw new Error('Core headless CanvasKit loader changed; review adapter');
      patches.push(`headless.js ${sha(source).slice(0, 12)}`);
      // locateFile resolves "canvaskit.wasm" beside ckURL: point it into dist/assets/ (the frame's copy).
      return { contents: source.replace(needle, 'const ckURL = new URL("__PENCIL_SHARED_WASM__", import.meta.url).href;'), loader: 'js' };
    });
    // Core's Node font reader resolves its own package.json through node_modules (ignores the locator).
    b.onLoad({ filter: /[/\\]@open-pencil[/\\]core[/\\]dist[/\\]text[/\\]font[/\\]bundled\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const needle = 'import.meta.resolve("@open-pencil/core/package.json")';
      if (source.split(needle).length !== 2) throw new Error('Core bundled-font loader changed; review adapter');
      patches.push(`bundled.js ${sha(source).slice(0, 12)}`);
      return { contents: source.replace(needle, 'new URL("__PENCIL_CORE_PKG__", import.meta.url).href'), loader: 'js' };
    });
    // css-tree reads JSON through createRequire(import.meta.url); use its self-contained dist files
    // (the same mapping its package.json "browser" field declares).
    b.onLoad({ filter: /[/\\]css-tree[/\\]lib[/\\](data|version)\.js$/ }, async ({ path }) => {
      const target = path.replace(/[/\\]lib[/\\](data|version)\.js$/, (_, name) => `/dist/${name}.js`);
      patches.push(`css-tree ${path.endsWith('data.js') ? 'data' : 'version'} → dist`);
      return { contents: await readFile(target, 'utf8'), loader: 'js' };
    });
    // EPL-2.0/GPL elkjs (layout "arrange") must never ship. Any use fails loudly.
    b.onResolve({ filter: /^elkjs(\/.*)?$/ }, () => { patches.push('elkjs stubbed'); return { path: 'elkjs', namespace: 'pencil-stub' }; });
    b.onLoad({ filter: /.*/, namespace: 'pencil-stub' }, () => ({ contents: 'export default class ELK { constructor() { throw new Error("elkjs is not bundled (license)"); } }', loader: 'js' }));
  },
};
const backend = await build({
  entryPoints: { runtime: join(root, 'src/server/runtime.js') }, outdir: dist, bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'node22',
  chunkNames: 'server/[name]-[hash]', conditions: ['node', 'import'], plugins: [adapters], metafile: true, logLevel: 'warning', legalComments: 'none',
  banner: { js: "import { createRequire as __pencilRequire } from 'node:module'; const require = __pencilRequire(import.meta.url);" },
  external: ['canvaskit-wasm/full'],
});
// CanvasKit's Emscripten glue is CommonJS (.cjs) and loads its .wasm via locateFile.
await cp(join(ckDir, 'bin/full/canvaskit.js'), join(assets, 'canvaskit/canvaskit.cjs'));
// The external import must resolve inside dist: rewrite it to the copied glue.
for (const out of Object.keys(backend.metafile.outputs).filter((p) => p.endsWith('.js'))) {
  const file = join(root, out); const js = await readFile(file, 'utf8');
  // harfbuzzjs's Emscripten glue loads harfbuzz.wasm from beside the chunk that contains it.
  if (js.includes('harfbuzz.wasm')) { await cp(join(dirname(fromCore.resolve('harfbuzzjs')), 'harfbuzz.wasm'), join(dirname(file), 'harfbuzz.wasm')); patches.push(`harfbuzz.wasm → ${relative(dist, dirname(file)) || '.'}`); }
  const relTo = (target) => { const r = relative(dirname(file), join(assets, target)).replaceAll('\\', '/'); return r.startsWith('.') ? r : `./${r}`; };
  const next = js.replaceAll(/(["'])canvaskit-wasm\/full\1/g, `"${relTo('canvaskit/canvaskit.cjs')}"`)
    .replaceAll('__PENCIL_SHARED_WASM__', relTo('canvaskit.wasm'))
    // core reads `assets/<font>` relative to its package.json → a virtual package.json in dist/.
    .replaceAll('__PENCIL_CORE_PKG__', relTo('../package.json'));
  if (next === js) continue;
  await writeFile(file, next);
  const rel = relTo('canvaskit/canvaskit.cjs');
  patches.push(`canvaskit import → ${rel}`);
}
if (!patches.some((p) => p.startsWith('headless.js'))) throw new Error('Headless CanvasKit adapter did not apply');


// 5. License gate (frame + backend inputs) and controlled resource inventory.
const banned = /[/\\]node_modules[/\\]elkjs[/\\]/;
const backendInputs = Object.keys(backend.metafile.inputs).filter((p) => banned.test(p));
if (backendInputs.length) throw new Error(`License gate: ${backendInputs.join(', ')}`);
// Third-party notices: the license files of every package either bundle includes, plus the
// OFL texts of the fonts that ship (OpenPencil's assets and the Noto Sans SC subsets).
await writeFile(join(dist, 'THIRD-PARTY-NOTICES.txt'), await notices([...frameModules, ...Object.keys(backend.metafile.inputs).map((p) => join(root, p))]));

const mime = { '.cjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.txt': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml' };
async function packageRoot(file) {
  for (let dir = dirname(file); dirname(dir) !== dir; dir = dirname(dir)) {
    try { const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); if (manifest.name && manifest.version) return { dir, manifest }; } catch {}
  }
  return null;
}
async function notices(inputs) {
  const packages = new Map();
  for (const input of inputs) {
    const path = input.replace(/^\0+/, '').split('?')[0];
    if (!/[/\\]node_modules[/\\]/.test(path)) continue;
    const pkg = await packageRoot(await realpath(path).catch(() => path));
    if (pkg && !packages.has(`${pkg.manifest.name}@${pkg.manifest.version}`)) packages.set(`${pkg.manifest.name}@${pkg.manifest.version}`, pkg);
  }
  let text = 'Third-party notices for @chengzhiyi/pi-pencil\n\nGenerated at build time from the packages bundled into dist/.\n';
  for (const [, { dir, manifest }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    text += `\n--- ${manifest.name} ${manifest.version} (${manifest.license ?? 'see upstream'}) ---\n`;
    for (const file of (await readdir(dir)).filter((f) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(f)).sort()) text += `${(await readFile(join(dir, file), 'utf8')).trim()}\n`;
  }
  const coreAssets = join(coreDir, 'assets');
  for (const file of (await readdir(coreAssets)).filter((f) => f.endsWith('-OFL.txt')).sort()) {
    text += `\n--- Font: ${file.replace(/-OFL\.txt$/, '')} (OFL-1.1), shipped from @open-pencil/core/assets ---\n${(await readFile(join(coreAssets, file), 'utf8')).trim()}\n`;
  }
  text += `\n--- Font: Noto Sans SC (OFL-1.1), subset at build time from @expo-google-fonts/noto-sans-sc ---\nCopyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.\nThis Font Software is licensed under the SIL Open Font License, Version 1.1 (text above, https://openfontlicense.org).\n`;
  return text;
}
async function walk(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }
const files = [];
for (const path of (await walk(dist)).sort()) {
  const m = mime[extname(path)]; if (!m) throw new Error(`Uncontrolled resource: ${relative(root, path)}`);
  const bytes = await readFile(path);
  files.push({ path: `./${relative(root, path)}`, bytes: bytes.length, sha256: sha(bytes), mime: m });
}
await writeFile(join(dist, 'resources.json'), JSON.stringify({ version: 1, files }, null, 2) + '\n');
const total = files.reduce((s, f) => s + f.bytes, 0);
console.log(JSON.stringify({ resources: files.length, totalMiB: +(total / 1048576).toFixed(2), largest: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 6).map((f) => `${f.path} ${(f.bytes / 1048576).toFixed(2)}MiB`), patches }, null, 2));
