import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

test('materialization preserves bare shapes, groups and arrow bindings without phantom labels', async () => {
  const { outputFiles } = await build({ entryPoints: ['src/client/scene-adapter.ts'], bundle: true, write: false, format: 'iife', globalName: 'adapter', platform: 'browser', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: outputFiles[0].text });
    const result = await page.evaluate(() => {
      const empty = { type: 'excalidraw', version: 2, source: 'pi-webapp', elements: [], appState: { viewBackgroundColor: '#fff' }, files: {} };
      const shape = (id, x, label) => ({ type: 'rectangle', id, x, y: 0, width: 240, height: 100, groupIds: ['native-group'], ...(label ? { label: { text: label } } : {}) });
      const base = adapter.materialize(empty, { elements: [shape('a', 0), shape('b', 500), { type: 'arrow', id: 'edge', x: 250, y: 50, points: [[0, 0], [240, 0]], start: { id: 'a' }, end: { id: 'b' } }] });
      const patch = (scene, update) => adapter.materialize(scene, { patch: { updateElements: [{ id: 'a', ...update }] } });
      const moved = patch(base, { x: 20 });
      const styled = patch(moved, { backgroundColor: '#ffffff', width: 300 });
      const labeled = patch(styled, { label: 'new label' });
      const renamed = patch(labeled, { label: 'renamed' });
      const cleared = patch(renamed, { label: '' });
      const emptyLabel = patch({ ...base, elements: [...base.elements.map(e => e.id === 'a' ? { ...e, boundElements: [...(e.boundElements ?? []), { id: 'empty-label', type: 'text' }] } : e), { id: 'empty-label', type: 'text', text: '', originalText: '', containerId: 'a', x: 0, y: 0, width: 0, height: 20 }] }, { x: 30 });
      const deletedLabel = patch({ ...labeled, elements: labeled.elements.map(e => e.type === 'text' ? { ...e, isDeleted: true } : e) }, { x: 40 });
      const clearedBare = patch(base, { label: '' });
      return { moved, styled, labeled, renamed, cleared, emptyLabel, deletedLabel, clearedBare };
    });
    for (const scene of [result.moved, result.styled, result.cleared, result.emptyLabel, result.deletedLabel, result.clearedBare]) {
      assert.equal(scene.elements.filter(e => !e.isDeleted && e.type === 'text').length, 0);
      const a = scene.elements.find(e => e.id === 'a');
      assert.deepEqual(a.groupIds, ['native-group']);
      assert.equal(a.boundElements.filter(e => e.type === 'text').length, 0);
      assert.ok(a.boundElements.some(e => e.id === 'edge'));
      const edge = scene.elements.find(e => e.id === 'edge');
      assert.equal(edge.startBinding.elementId, 'a');
      assert.equal(edge.endBinding.elementId, 'b');
    }
    assert.equal(result.moved.elements.find(e => e.id === 'a').x, 20);
    const old = result.labeled.elements.find(e => e.type === 'text');
    const renamed = result.renamed.elements.find(e => e.type === 'text');
    assert.equal(renamed.id, old.id);
    assert.equal(renamed.text, 'renamed');
    assert.equal(renamed.containerId, 'a');
  } finally { await browser.close(); }
});
