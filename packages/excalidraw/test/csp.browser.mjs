// Real HTTP + exact packaged bytes, not route.fulfill. Server is test-scoped and closed in finally.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
const archive=resolve(process.env.PI_EXCALIDRAW_TGZ ?? '../../artifacts/chengzhiyi-pi-excalidraw-0.1.0.tgz');
const dir=await mkdtemp(join(tmpdir(),'excalidraw-csp-'));
execFileSync('tar',['-xzf',archive,'-C',dir]);
const root=join(dir,'package');
const manifest=JSON.parse(await readFile(join(root,'dist/resources.json')));
const dormantWasm=[];
for(const file of manifest.files) {
 const bytes=await readFile(join(root,file.path));
 assert.equal(bytes.length,file.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
 if(file.path.endsWith('.js')) {
  const js=bytes.toString();
  // Lodash's global fallback is unreachable in browser/worker realms (self exists).
  const checked=js.replace(/\|\| Function\("return this"\)\(\)/g,'');
  assert.doesNotMatch(checked,/\bFunction\s*\(|\beval\s*\(/,file.path);
  if(/WebAssembly\.(?:instantiate|compile)/.test(js)) {
   assert.match(js,/\/(?:pica|image-blob-reduce)\//,file.path);
   dormantWasm.push('/'+file.path.slice(2));
  }
 }
}
const resources=new Map(manifest.files.map(f=>['/'+f.path.slice(2),f]));
const served=new Set();
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><iframe style="width:1100px;height:850px"></iframe>');return;}
 res.setHeader('Content-Security-Policy',CSP);
 const file=resources.get(url.pathname);
 if(!file){res.writeHead(404);res.end();return;}
 served.add(url.pathname);res.setHeader('Content-Type',file.mime);res.end(await readFile(join(root,file.path)));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const errors=[],unexpected=[],violations=[],consoleErrors=[],policy=[];
const text='中文流程图：开始 → 完成 CSP fonts';
const element={id:'chinese',type:'text',x:100,y:100,width:600,height:50,angle:0,strokeColor:'#1e1e1e',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:1,opacity:100,groupIds:[],frameId:null,index:'a0',roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:null,updated:1,link:null,locked:false,text,originalText:text,fontSize:28,fontFamily:5,textAlign:'left',verticalAlign:'top',containerId:null,autoResize:true,lineHeight:1.25};
try {
 const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());if(m.text().includes('Excalidraw CSP:'))policy.push(m.text());});
 page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))unexpected.push(r.url());});
 await page.exposeFunction('cspViolation',e=>violations.push(e));
 await page.addInitScript(()=>{
  // Exercise Excalidraw's native browser-download fallback instead of an OS picker.
  delete window.showSaveFilePicker;
  document.addEventListener('securitypolicyviolation',e=>window.cspViolation({directive:e.effectiveDirective,blocked:e.blockedURI}));
 });
 async function mount(kind) {
  await page.goto(origin);
  await page.evaluate(({origin,element,kind})=>{
   window.received=[];window.rpcPort=null;
   window.draft={id:'drawing',title:'中文图稿',revision:1,path:null,diskHash:null,savedRevision:1,candidate:null,scene:{type:'excalidraw',version:2,source:'pi-webapp',elements:[element],appState:{viewBackgroundColor:'#ffffff'},files:{}}};
   const frame=document.querySelector('iframe');
   frame.onload=()=>{const channel=new MessageChannel();window.rpcPort=channel.port1;
    channel.port1.onmessage=e=>{window.received.push(e.data);if(e.data.type==='request'){
     let value=null;if(e.data.method==='action'){
      if(e.data.input.action==='sync'){window.draft.scene=e.data.input.input.scene;window.draft.revision++;}
      if(['get','sync'].includes(e.data.input.action))value=window.draft;
     }
     channel.port1.postMessage({type:'response',id:e.data.id,ok:true,value});
    }};channel.port1.start();
    frame.contentWindow.postMessage({type:'pi:hosted:connect',protocol:1,pluginId:'excalidraw',generation:7,mountId:'csp'},origin,[channel.port2]);
   };
   frame.src=`${origin}/dist/frame.html?parentOrigin=${encodeURIComponent(origin)}&pluginId=excalidraw&generation=7&mountId=csp`;
  },{origin,element,kind});
  await page.waitForFunction(()=>!!window.rpcPort);
  assert.equal((await rpc('initialize',{kind,sessionId:'csp-session',contentId:'drawing',locale:'en',theme:'light',visible:true})).ok,true);
  return page.frames().find(f=>f.url().includes('/dist/frame.html'));
 }
 let seq=0;
 async function rpc(method,input) {
  const id=`csp-${++seq}`;
  await page.evaluate(({method,input,id})=>window.rpcPort.postMessage({type:'request',id,method,input}),{method,input,id});
  await page.waitForFunction(id=>window.received.some(m=>m.type==='response'&&m.id===id),id);
  return page.evaluate(id=>window.received.find(m=>m.type==='response'&&m.id===id),id);
 }
 let frame=await mount('tool');
 await rpc('update',{result:{blocks:[{kind:'text',text:JSON.stringify({id:'drawing',title:'中文图稿'})}]},running:false});
 const image=frame.locator('[data-diagram-preview] img');await image.waitFor({timeout:30000});
 const svg=await page.evaluate(async src=>await(await fetch(src)).text(),await image.getAttribute('src'));
 assert.ok(svg.includes(text));
 const fonts=[...svg.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)].map(m=>Buffer.from(m[1],'base64'));
 assert.ok(fonts.length>0,'SVG must embed WOFF2 fonts');
 const packagedFonts=await Promise.all(manifest.files.filter(f=>f.path.endsWith('.woff2')).map(f=>readFile(join(root,f.path))));
 for(const font of fonts) assert.ok(packagedFonts.some(bytes=>bytes.equals(font)),'embedded partition must be byte-exact original, not degraded');
 // Browser font decoder validates complete embedded bytes, not merely their header.
 await frame.evaluate(async fonts=>{for(const [i,data] of fonts.entries())await new FontFace(`CSP-${i}`,`url(data:font/woff2;base64,${data})`).load();},fonts.map(f=>f.toString('base64')));
 await rpc('dispose');
 frame=await mount('editor');await frame.locator('.excalidraw').waitFor();
 await frame.getByTestId('main-menu-trigger').click();
 await frame.getByText('Export image', {exact:false}).click();
 const pngDownload=page.waitForEvent('download');
 await frame.getByRole('button',{name:'Export to PNG',exact:true}).click();
 const png=await pngDownload; const pngBytes=await readFile(await png.path());
 assert.equal(pngBytes.subarray(1,4).toString(),'PNG');assert.ok(pngBytes.length>1000);
 await page.keyboard.press('Escape');
 await frame.getByTestId('main-menu-trigger').click();
 await frame.getByText('Save to...', {exact:true}).click();
 const sourceDownload=page.waitForEvent('download');
 await frame.getByRole('button',{name:'Save to file',exact:true}).click();
 const source=JSON.parse(await readFile(await(await sourceDownload).path(),'utf8'));
 assert.equal(source.type,'excalidraw');assert.ok(source.elements.some(e=>e.type==='text'&&e.text===text));
 await page.keyboard.press('Escape');
 assert.equal((await rpc('dispose')).ok,true);
 assert.ok(policy.length>0,'full-font policy must be observable');
 for(const path of dormantWasm) assert.ok(!served.has(path),`Unvalidated WASM path loaded: ${path}`);
 assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(consoleErrors,[]);
 console.log(JSON.stringify({archiveSha256:createHash('sha256').update(await readFile(archive)).digest('hex'),svgBytes:Buffer.byteLength(svg),pngBytes:pngBytes.length,embeddedFonts:fonts.length,served:served.size,policy,pageErrors:errors.length,cspViolations:violations.length,externalRequests:unexpected.length},null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
