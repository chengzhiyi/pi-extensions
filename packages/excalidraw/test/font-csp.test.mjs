import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {b,c,d} from '../scripts/full-font-embedding.mjs';
test('full-font embedding preserves complete real WOFF2 partitions and rejects malformed headers',async()=>{
 const folder='dist/fonts/Excalifont';
 for(const name of await readdir(folder)) {
  if(!name.endsWith('.woff2'))continue;
  const bytes=await readFile(`${folder}/${name}`);
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  assert.equal(await c(buffer),buffer);
  const uri=await b(buffer,[0x4e2d]);
  assert.deepEqual(Buffer.from(uri.split(',')[1],'base64'),bytes);
  assert.equal(uri,await d(buffer));
 }
 for(const buffer of [new ArrayBuffer(0),new ArrayBuffer(48)]) await assert.rejects(c(buffer),/valid WOFF2/);
});
