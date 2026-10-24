import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {validatePackedPackage} from '../../../scripts/pack.mjs';
const destination=resolve('../../artifacts'); await mkdir(destination,{recursive:true});
execFileSync('pnpm',['pack','--pack-destination',destination],{stdio:'pipe'});
const expected=JSON.parse(await readFile('package.json','utf8'));
const tarball=join(destination,`${expected.name.replace('@','').replace('/','-')}-${expected.version}.tgz`);
const protocol=JSON.parse(await readFile('../protocol/package.json','utf8'));
const manifest=validatePackedPackage(tarball,expected,new Map([[protocol.name,protocol.version]]));
assert.equal(manifest.piWebapp.apiVersion,2);
const directory=join(destination,'tgz-install'); await rm(directory,{recursive:true,force:true});
await mkdir(join(directory,'node_modules/@chengzhiyi/pi-excalidraw'),{recursive:true});
// Exact tarball extraction models a host's package install, without npm/network or dependencies.
execFileSync('tar',['-xf',tarball,'--strip-components=1','-C',join(directory,'node_modules/@chengzhiyi/pi-excalidraw')]);
await writeFile(join(directory,'package.json'),'{"private":true,"type":"module"}');
await writeFile(join(directory,'smoke.mjs'),`import assert from 'node:assert/strict';
import {createRuntime} from '@chengzhiyi/pi-excalidraw';
let state=null;
const runtime=await createRuntime({pluginId:'excalidraw',version:'0.1.0',generation:1,broker:{async call(method,input){
 if(method==='state.read')return state;
 if(method==='legacy.read')return null;
 if(method==='state.compareAndSwap'){assert.equal(input.expectedRevision,state?.revision??0);return state={revision:input.expectedRevision+1,schema:input.schema,value:input.value};}
 throw new Error('Unexpected broker call '+method);
}}});
assert.equal((await runtime.describe()).tools.length,6);
const draft=await runtime.invoke({requestId:'1',generation:1,scope:{cwd:'/work',workspaceId:'work',sessionId:'session'},kind:'action',action:'new',input:{}});
assert.equal(state.value.drafts[0].id,draft.id);await runtime.dispose();
console.log('Exact tgz install and backend entry passed, no runtime node_modules dependencies');`);
execFileSync(process.execPath,['smoke.mjs'],{cwd:directory,stdio:'inherit',env:{...process.env,NODE_PATH:''}});
console.log(`Entrypoints, resource integrity and controlled archive passed: ${tarball}`);
