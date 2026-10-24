import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntime } from '../src/server/runtime.ts';
import { emptyScene } from '../src/contract/diagrams.ts';
function fixture(legacy: unknown = null) {
  const states = new Map<string, any>(), files = new Map<string, any>(); const calls: any[] = [];
  let scope = 'a', rejectCAS = false;
  const broker = {async call(method: string, input: any): Promise<any> {
    calls.push({method, input: structuredClone(input), scope});
    if (method === 'state.read') return structuredClone(states.get(scope) ?? null);
    if (method === 'legacy.read') return structuredClone(legacy);
    if (method === 'state.compareAndSwap') {
      assert.match(input.key, /^[\w.-]{1,160}$/);
      const current = states.get(scope);
      if (rejectCAS || (current?.revision ?? 0) !== input.expectedRevision) throw new Error('CAS conflict');
      const next = {revision: input.expectedRevision + 1, schema: input.schema, value: structuredClone(input.value)}; states.set(scope, next); return next;
    }
    if (method === 'workspace.read') return structuredClone(files.get(input.path) ?? null);
    if (method === 'workspace.commit') {
      const current = files.get(input.path);
      if ((current?.hash ?? null) !== input.expectedHash) throw new Error('File conflict');
      const hash = 'a'.repeat(64); files.set(input.path, {text: input.text, hash}); return {hash};
    }
    throw new Error(method);
  }};
  return {broker, states, files, calls, setScope(s: string) {scope = s;}, conflict(v: boolean) {rejectCAS = v;}};
}
const invocation = (action: string, input: unknown = {}, kind: 'action'|'tool' = 'action', sessionId = 'a') => ({requestId: 'request', generation: 7, scope: {cwd:'/work', workspaceId:'workspace', sessionId}, action, input, kind});
test('runtime describes tools, checkpoints focus and revisions, reloads every invocation and isolates scopes', async () => {
  const f = fixture(); const runtime = await createRuntime({pluginId:'excalidraw',version:'0.1.0',generation:7,broker:f.broker});
  assert.equal((await runtime.describe()).tools.length, 6);
  await runtime.invoke(invocation('reference', {}, 'tool')); assert.equal(f.calls.length, 0);
  const a: any = await runtime.invoke(invocation('new'));
  assert.equal(f.states.get('a').revision, 1); assert.equal(f.states.get('a').value.focused, a.id);
  assert.equal(a.revision, 0);
  await runtime.invoke(invocation('sync', {id:a.id,revision:0,scene:emptyScene()}));
  assert.equal(f.states.get('a').value.drafts[0].revision, 1);
  await assert.rejects(runtime.invoke(invocation('sync', {id:a.id,revision:0,scene:emptyScene()})), /修订/);
  const second = await createRuntime({pluginId:'excalidraw',version:'0.1.0',generation:7,broker:f.broker});
  assert.equal((await second.invoke(invocation('get',{id:a.id})) as any).revision, 1);
  f.setScope('b'); await assert.rejects(runtime.invoke(invocation('get',{id:a.id},'action','b')), /当前会话/);
  f.setScope('a'); f.conflict(true);
  await assert.rejects(runtime.invoke(invocation('sync',{id:a.id,revision:1,scene:emptyScene()})), /CAS conflict/);
  assert.equal(f.states.get('a').value.drafts[0].revision, 1);
  await assert.rejects(runtime.invoke({...invocation('list'), generation:6}), /Stale/);
  await runtime.dispose?.(); await assert.rejects(runtime.invoke(invocation('list')), /disposed/);
});
test('workspace broker enforces expected hash/no replace and rejects unsafe paths before IO', async () => {
  const f = fixture(); const r = await createRuntime({pluginId:'excalidraw',version:'0.1.0',generation:7,broker:f.broker});
  const a: any = await r.invoke(invocation('new'));
  for (const path of ['../a.excalidraw','/a.excalidraw','a\\b.excalidraw','a.txt','C:a.excalidraw']) await assert.rejects(r.invoke(invocation('save',{id:a.id,revision:0,path})), /相对/);
  const saved: any = await r.invoke(invocation('save',{id:a.id,revision:0,path:'diagrams/a.excalidraw'}));
  assert.equal(saved.diskHash, 'a'.repeat(64));
  await r.invoke(invocation('save',{id:a.id,revision:0,path:'diagrams/a.excalidraw'}));
  assert.equal(f.calls.filter(c => c.method === 'workspace.commit').at(-1).input.expectedHash, saved.diskHash);
  f.files.set('existing.excalidraw',{text:'{}',hash:'b'.repeat(64)});
  await assert.rejects(r.invoke(invocation('save',{id:a.id,revision:0,path:'existing.excalidraw'})), /File conflict/);
  assert.equal(f.files.get('existing.excalidraw').text, '{}');
  f.files.set('invalid.excalidraw',{text:'{broken',hash:'b'.repeat(64)});
  await assert.rejects(r.invoke(invocation('open',{path:'invalid.excalidraw'})),/JSON|Expected/);
  f.files.set('executable.excalidraw',{text:JSON.stringify({...emptyScene(),elements:[{id:'bad',type:'iframe',x:0,y:0,width:100,height:100}]}),hash:'b'.repeat(64)});
  await assert.rejects(r.invoke(invocation('open',{path:'executable.excalidraw'})));
});
test('legacy is validated then CAS imported once; corrupt and unsupported records never clear data', async () => {
  const f = fixture({drafts:[],focused:null}); const r = await createRuntime({pluginId:'excalidraw',version:'0.1.0',generation:7,broker:f.broker});
  await r.invoke(invocation('list')); await r.invoke(invocation('list'));
  assert.equal(f.calls.filter(c => c.method === 'legacy.read').length, 1);
  assert.equal(f.states.get('a').revision, 1);
  f.states.set('a',{revision:1,schema:2,value:{}});
  await assert.rejects(r.invoke(invocation('list')), /Unsupported/);
  const bad = fixture({drafts:[{}],focused:null}); const b = await createRuntime({pluginId:'excalidraw',version:'0.1.0',generation:7,broker:bad.broker});
  await assert.rejects(b.invoke(invocation('list'))); assert.equal(bad.states.size, 0);
});

test('legacy migration preserves exact IDs, geometry, stale candidate, focus, saved revision and disk hash across restart', async () => {
  const scene = {...emptyScene(), elements:[{id:'hand',type:'rectangle',x:999,y:30,width:200,height:100,groupIds:['核心层']}]};
  const draft = {id:'historical',title:'旧图稿',scene,revision:7,savedRevision:5,path:'图稿/原稿.excalidraw',diskHash:'b'.repeat(64),candidate:{id:'stale',baseRevision:6,patch:{removeIds:['removed-before-migration']}}};
  const legacy = {drafts:[draft],focused:draft.id};
  const original = structuredClone(legacy), f = fixture(legacy);
  const options = {pluginId:'excalidraw',version:'0.1.0',generation:7,broker:f.broker};
  let runtime = await createRuntime(options);
  assert.deepEqual(await runtime.invoke(invocation('get',{id:draft.id})),draft);
  assert.deepEqual(f.states.get('a').value,original);
  assert.equal(f.states.get('a').revision,1);
  await runtime.dispose?.(); runtime = await createRuntime(options);
  assert.equal((await runtime.invoke(invocation('read',{},'tool')) as any).id,draft.id);
  await assert.rejects(runtime.invoke(invocation('accept',{id:draft.id,revision:7,candidateId:'stale',scene})),/旧图稿/);
  assert.deepEqual(f.states.get('a').value,original);
  await runtime.invoke(invocation('reject',{id:draft.id,revision:7,candidateId:'stale'}));
  assert.equal(f.states.get('a').value.drafts[0].revision,7);
  assert.equal(f.states.get('a').value.drafts[0].candidate,null);
  assert.equal(f.calls.filter(c=>c.method==='legacy.read').length,1);
  assert.equal(f.calls.filter(c=>c.method.startsWith('workspace.')).length,0);
  assert.deepEqual(legacy,original); // no native file or legacy-source rewrite during import
});
