import { build } from 'esbuild';
import { notices } from './notices.mjs';
import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir, rm, cp, readdir} from 'node:fs/promises';
import {dirname, join, extname} from 'node:path';
import {createHash} from 'node:crypto';
const require = createRequire(import.meta.url);
// Fail closed on upstream drift; never modify the installed dependency tree.
const fontCspPlugin = {name:'excalidraw-csp-full-fonts', setup(build) {
  let replacements = 0;
  build.onLoad({filter:/[/\\]dist[/\\]prod[/\\]chunk-EIO257PC\.js$/}, async ({path}) => {
    const original = await readFile(path);
    if (createHash('sha256').update(original).digest('hex') !== '6ca0a6b4a49be83ed6beb32f845648ca4927c592cc0f4ba43a909624f5659493') throw new Error('Excalidraw font glue changed; review CSP adapter before building');
    replacements++;
    return {contents:await readFile(new URL('./full-font-embedding.mjs', import.meta.url),'utf8'),loader:'js'};
  });
  let urlPatches = 0;
  build.onLoad({filter:/[/\\]dist[/\\]prod[/\\]chunk-K2UTITRG\.js$/}, async ({path}) => {
    const source = await readFile(path,'utf8');
    const fallback = 'return r.push(new URL(n,jn.ASSETS_FALLBACK_URL)),r';
    if (createHash('sha256').update(source).digest('hex') !== '72b54e8e9b3c17c69f1dd5e40203bfaed62313bc611b86ecb8a1625a12562e51' || source.split(fallback).length !== 2) throw new Error('Excalidraw font URL source changed; review local-only patch');
    urlPatches++;
    return {contents:source.replace(fallback,'if(!r.length)throw new Error("Local Excalidraw font asset path is required");return r'),loader:'js'};
  });
  build.onEnd(() => {if (replacements !== 1 || urlPatches !== 1) throw new Error(`Expected one font adapter and URL patch, got ${replacements}/${urlPatches}`);});
}};
await rm('dist', {recursive:true, force:true}); await mkdir('dist');
await build({entryPoints:['src/server/runtime.ts'], outfile:'dist/runtime.js', bundle:true, platform:'node', format:'esm', target:'node22'});
const browser = await build({plugins:[fontCspPlugin], entryPoints:['src/client/frame.tsx'], outdir:'dist', entryNames:'frame', chunkNames:'chunk-[hash]', assetNames:'asset-[hash]', bundle:true, splitting:true, conditions:['production'], platform:'browser', format:'esm', target:'es2022', jsx:'automatic', define:{'process.env.NODE_ENV':'"production"'}, loader:{'.woff2':'file','.woff':'file','.ttf':'file'}, metafile:true});
if (process.env.PI_EXCALIDRAW_BUILD_META) await writeFile(process.env.PI_EXCALIDRAW_BUILD_META, JSON.stringify(browser.metafile));
const excalidraw = join(dirname(require.resolve('@excalidraw/excalidraw')), '../..');
await cp(join(excalidraw,'dist/prod/fonts'), 'dist/fonts', {recursive:true});
await notices(browser.metafile);
await cp('NOTICE.txt', 'dist/FONT-NOTICES.txt');
await writeFile('dist/frame.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./frame.css"></head><body><div id="root"></div><script type="module" src="./frame.js"></script></body></html>\n');
const mime = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.txt':'text/plain'};
async function walk(dir) {let files=[]; for(const e of await readdir(dir,{withFileTypes:true})) files.push(...(e.isDirectory()? await walk(join(dir,e.name)):[join(dir,e.name)])); return files;}
const files=[];
for (const path of (await walk('dist')).sort()) {
  if (!mime[extname(path)]) throw new Error(`Uncontrolled resource: ${path}`);
  const bytes=await readFile(path); files.push({path:`./${path}`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime:mime[extname(path)]});
}
await writeFile('dist/resources.json',JSON.stringify({version:1,files},null,2)+'\n');
console.log(`Built self-contained backend/frame and ${files.length} controlled resources`);
