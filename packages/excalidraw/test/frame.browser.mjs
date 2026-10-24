import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage(); const unexpected=[], errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='host.test') return route.fulfill({contentType:'text/html',body:'<iframe style="width:1000px;height:750px" src="http://plugin.test/frame.html?parentOrigin=http%3A%2F%2Fhost.test&pluginId=excalidraw&generation=7&mountId=editor-1"></iframe>'});
   if(url.hostname!=='plugin.test') {unexpected.push(url.href);return route.abort();}
   const path=resolve('dist',url.pathname.slice(1));
   if(!path.startsWith(resolve('dist')+'/')) return route.abort();
   try {await route.fulfill({body:await readFile(path),contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream'});} catch {await route.abort();}
 });
 await page.goto('http://host.test'); await page.waitForTimeout(500);
 await page.evaluate(async()=>{
   const frame=document.querySelector('iframe'); const channel=new MessageChannel();
   const messages=[]; window.received=messages;
   channel.port1.onmessage=e=>{messages.push(e.data); if(e.data.type==='request') {
     let value=null;
     if(e.data.method==='action') {
       const {action,input}=e.data.input;
       if(action==='get') value={id:'drawing',title:'中文图稿',revision:0,path:null,diskHash:null,savedRevision:null,candidate:null,scene:{type:'excalidraw',version:2,source:'pi-webapp',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}}};
       if(action==='sync') value={id:'drawing',title:'中文图稿',revision:input.revision+1,path:null,diskHash:null,savedRevision:null,candidate:null,scene:input.scene};
     }
     channel.port1.postMessage({type:'response',id:e.data.id,ok:true,value});
   }};
   channel.port1.start(); window.rpcPort=channel.port1;
   // Wrong generation must not consume the one-shot handshake.
   frame.contentWindow.postMessage({type:'pi:hosted:connect',protocol:1,pluginId:'excalidraw',generation:6,mountId:'editor-1'},'http://plugin.test',[channel.port2]);
 });
 // Use a fresh channel for the accepted connection; stale handshake was ignored.
 await page.evaluate(()=>{
   const channel=new MessageChannel(); window.rpcPort.close();
   window.draft={id:'drawing',title:'中文图稿',revision:0,path:null,diskHash:null,savedRevision:null,candidate:null,scene:{type:'excalidraw',version:2,source:'pi-webapp',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}}};
   channel.port1.onmessage=e=>{window.received.push(e.data); if(e.data.type==='request') {
     let value=null;
     if(e.data.method==='action') {
       if(e.data.input.action==='sync') {window.draft.scene=e.data.input.input.scene; window.draft.revision++;}
       if(['get','sync'].includes(e.data.input.action)) value=window.draft;
     }
     channel.port1.postMessage({type:'response',id:e.data.id,ok:true,value});
   }};
   channel.port1.start();window.rpcPort=channel.port1;
   document.querySelector('iframe').contentWindow.postMessage({type:'pi:hosted:connect',protocol:1,pluginId:'excalidraw',generation:7,mountId:'editor-1'},'http://plugin.test',[channel.port2]);
 });
 let seq=0;
 async function rpc(method,input) {
   const id=`host-${++seq}`;
   await page.evaluate(({method,input,id})=>window.rpcPort.postMessage({type:'request',id,method,input}),{method,input,id});
   await page.waitForFunction(id=>window.received.some(m=>m.type==='response'&&m.id===id),id);
   return page.evaluate(id=>window.received.find(m=>m.type==='response'&&m.id===id),id);
 }
 assert.equal((await rpc('describe')).value.entry.label,'Excalidraw');
 assert.equal((await rpc('initialize',{kind:'editor',sessionId:'session',contentId:'drawing',locale:'zh',theme:'dark',visible:true})).ok,true);
 const frame=page.frames().find(f=>f.url().includes('plugin.test'));
 await frame.locator('.excalidraw').waitFor();
 assert.equal(await frame.locator('body').getAttribute('data-ds-dark-theme'),'');
 assert.equal((await rpc('flush')).ok,true);
 // A real native drag must become a synchronized valid scene on flush.
 await frame.locator('label').filter({has: frame.locator('[data-testid="toolbar-rectangle"]')}).click();
 const box=await frame.locator('.excalidraw').boundingBox();
 await page.mouse.move(box.x+300,box.y+300); await page.mouse.down(); await page.mouse.move(box.x+500,box.y+420); await page.mouse.up();
 assert.equal((await rpc('flush')).ok,true);
 assert.ok(await page.evaluate(()=>window.draft.scene.elements.some(e=>e.type==='rectangle')));
 assert.ok(await page.evaluate(()=>window.received.some(m=>m.type==='request'&&m.method==='action'&&m.input.action==='sync')));
 await frame.evaluate(()=>window.dispatchEvent(new CompositionEvent('compositionstart')));
 assert.equal((await rpc('flush')).ok,false);
 await frame.evaluate(()=>window.dispatchEvent(new CompositionEvent('compositionend')));
 await frame.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerdown',{pointerId:99})));
 assert.equal((await rpc('freeze')).ok,false);
 await frame.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:99})));
 const frozen=await rpc('freeze'); assert.equal(frozen.ok,true);
 assert.equal((await rpc('restore',frozen.value)).ok,true);
 assert.equal((await rpc('update',{sessionId:'other'})).ok,false);
 assert.equal((await rpc('update',{theme:'light'})).ok,true);
 assert.equal((await rpc('dispose')).ok,true);
 assert.deepEqual(unexpected,[]); assert.deepEqual(errors,[]);
 console.log('Browser iframe handshake/native canvas/theme/busy/flush/freeze/restore/dispose passed');
} finally {await browser.close();}
