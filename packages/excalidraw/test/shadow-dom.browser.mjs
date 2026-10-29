// Feasibility probe, NOT a production transport or a supported editor entry.
// Uses the actual independently built editor and its exact bundled React copy.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { chromium } from '@playwright/test';

const sources = await Promise.all((await readdir('dist')).filter(n => n.endsWith('.js')).map(async name => ({ name, text: await readFile(join('dist', name), 'utf8') })));
const moduleWith = pattern => {
  const found = sources.filter(s => pattern.test(s.text));
  assert.equal(found.length, 1, `Expected one built module matching ${pattern}`); return './' + found[0].name;
};
const canvas = moduleWith(/Canvas as default/), react = moduleWith(/export \{[^}]*\brequire_react\b[^}]*\}/), dom = moduleWith(/export \{[^}]*\brequire_react_dom\b[^}]*\}/);
const fixture = `import Canvas from ${JSON.stringify(canvas)};
import {require_react} from ${JSON.stringify(react)};
import {require_react_dom} from ${JSON.stringify(dom)};
const React = require_react(), {createRoot} = require_react_dom();
window.lifecycle ??= {mounts:0,disposals:0,changes:0};
class Probe extends HTMLElement {
 connectedCallback() {
  const shadow = this.shadowRoot ?? this.attachShadow({mode:'open'});
  const css = document.createElement('link'); css.rel='stylesheet'; css.href='./frame.css'; shadow.append(css);
  const target = document.createElement('div'); target.style.cssText='width:600px;height:650px'; shadow.append(target);
  this.root = createRoot(target); window.lifecycle.mounts++;
  this.root.render(React.createElement(Canvas,{scene:{type:'excalidraw',version:2,source:'probe',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}},readOnly:false,locale:'en',onChange:()=>window.lifecycle.changes++,onError:message=>{throw new Error(message)}}));
 }
 disconnectedCallback() {this.root.unmount();this.shadowRoot.replaceChildren();window.lifecycle.disposals++;}
}
// A stable tag cannot be redefined. Real upgrade support needs versioned tags
// or a stable wrapper with an explicit per-version factory; this probe uses a guard.
if (!customElements.get('editor-probe')) customElements.define('editor-probe',Probe);
document.body.append(document.createElement('editor-probe'));`;
const browser = await chromium.launch({headless:true});
const errors = [], external = [];
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(10_000);
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'shadow.test') { external.push(url.href); return route.abort(); }
    if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Real editor Shadow DOM probe</title><style>body{margin:24px}</style><script type="module" src="./probe.js"></script>'});
    if (url.pathname === '/probe.js') return route.fulfill({contentType:'text/javascript',body:fixture});
    const path = resolve('dist',url.pathname.slice(1));
    if (!path.startsWith(resolve('dist')+'/')) return route.abort();
    await route.fulfill({body:await readFile(path),contentType:({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)] ?? 'application/octet-stream'});
  });
  await page.goto('http://shadow.test');
  await page.locator('editor-probe canvas.interactive').waitFor();
  // A native menu works in the shadow tree, but its help dialog is portaled out.
  await page.getByTestId('main-menu-trigger').click();
  await page.getByTestId('help-menu-item').click();
  await page.getByRole('dialog').waitFor();
  const evidence = await page.evaluate(() => {
    const element = document.querySelector('editor-probe'), dialog = document.querySelector('[role="dialog"]');
    const modal = dialog.closest('.Modal');
    return { dialogOutsideShadow:!!dialog && dialog.getRootNode() === document,
      shadowDialogCount:element.shadowRoot.querySelectorAll('[role="dialog"]').length,
      modalPosition:modal ? getComputedStyle(modal).position : null,
      documentActiveElement:document.activeElement.tagName,
      globalFontAssetPath:window.EXCALIDRAW_ASSET_PATH,
      lifecycle:window.lifecycle };
  });
  assert.equal(evidence.dialogOutsideShadow,true);
  assert.equal(evidence.shadowDialogCount,0);
  assert.equal(evidence.modalPosition,'static', 'CSS injected into Shadow DOM does not style body portals');
  const output = resolve('../../artifacts/shadow-dom-probe'); await mkdir(output,{recursive:true});
  await page.screenshot({path:join(output,'body-portal.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { await import('./probe.js?generation=2'); });
  await page.locator('editor-probe canvas.interactive').nth(1).waitFor();
  assert.equal(await page.locator('editor-probe').count(),2);
  await page.evaluate(() => document.querySelectorAll('editor-probe').forEach(e => e.remove()));
  assert.equal(await page.locator('[role="dialog"]').count(),0);
  assert.equal(await page.evaluate(() => window.lifecycle.disposals),2);
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  const lifecycle = await page.evaluate(() => window.lifecycle);
  assert.equal(lifecycle.mounts,2);
  await writeFile(join(output,'evidence.json'),JSON.stringify({...evidence,lifecycle,errors,external},null,2));
  console.log('Shadow probe reproduced unstyled document-body portal; two guarded custom-element mounts disposed. Evidence:',output);
} finally { await browser.close(); }
