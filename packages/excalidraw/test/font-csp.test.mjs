import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {b,c,d} from '../scripts/full-font-embedding.mjs';
test('full-font embedding preserves complete real WOFF2 partitions and rejects malformed headers',async()=>{
 // Tests run before build in CI. Read the pinned vendor inputs, not stale dist output.
 const require=createRequire(import.meta.url);
 const folder=join(dirname(require.resolve('@excalidraw/excalidraw')),'fonts/Excalifont');
 const fonts=(await readdir(folder)).filter(name=>name.endsWith('.woff2'));
 assert.ok(fonts.length>0,'Pinned dependency must contain real font partitions');
 for(const name of fonts) {
  const bytes=await readFile(join(folder,name));
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  assert.equal(await c(buffer),buffer);
  const uri=await b(buffer,[0x4e2d]);
  assert.deepEqual(Buffer.from(uri.split(',')[1],'base64'),bytes);
  assert.equal(uri,await d(buffer));
 }
 for(const buffer of [new ArrayBuffer(0),new ArrayBuffer(48)]) await assert.rejects(c(buffer),/valid WOFF2/);
});
