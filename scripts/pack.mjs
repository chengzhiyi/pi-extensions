import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWorkspace } from './workspace.mjs';
import { withPackedFiles } from './archive.mjs';
import { timedSync } from './timing.mjs';

export function validatePackedPackage(tarball, expected, versions) {
  return withPackedFiles(tarball, (files, read) => validateFiles(files, read, expected, versions));
}

function validateFiles(files, read, expected, versions) {
  const manifest = JSON.parse(read('package/package.json'));
  const allowed = new Set(['package/package.json', 'package/README.md', 'package/LICENSE', 'package/NOTICE.txt']);
  if (manifest.piWebapp?.apiVersion === 2) {
    const resourcePath = manifest.piWebapp.resourcesManifest;
    assert(/^\.\/dist\/[\w.-]+\.json$/.test(resourcePath), 'Invalid resources manifest');
    const resourceFile = `package/${resourcePath.slice(2)}`;
    allowed.add(resourceFile);
    const resources = JSON.parse(read(resourceFile));
    assert.equal(resources.version, 1);
    assert(Array.isArray(resources.files) && resources.files.length <= 4096);
    for (const item of resources.files) {
      assert(/^\.\/dist\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|css|html|json|woff2?|ttf|txt)$/.test(item.path) && !item.path.split('/').slice(1).some(p => p === '.' || p === '..'), 'Uncontrolled resource');
      const path = `package/${item.path.slice(2)}`;
      assert(!allowed.has(path), 'Duplicate resource'); allowed.add(path);
      const bytes = read(path);
      assert.equal(bytes.length, item.bytes, `Resource size mismatch: ${path}`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, `Resource hash mismatch: ${path}`);
    }
  }
  if (manifest.piWebapp?.apiVersion === 2) {
    assert(files.filter(path => path.endsWith('/')).every(path => [...allowed].some(file => file.startsWith(path))), 'Uncontrolled archive directory');
  }
  assert.equal(new Set(files).size, files.length, 'Duplicate tar members');
  assert(files.every(file => file.endsWith('/') || allowed.has(file) || (manifest.piWebapp?.apiVersion !== 2 && /^package\/dist\/[^/]+\.(js|css|d\.ts)$/.test(file))), `Unexpected files in ${expected.name}`);
  assert.equal(manifest.name, expected.name);
  assert.equal(manifest.version, expected.version);
  assert(files.includes('package/LICENSE'), `Missing license in ${expected.name}`);
  const entrypoints = [manifest.main, manifest.types, ...(manifest.pi?.extensions ?? []), manifest.piWebapp?.client, manifest.piWebapp?.style, manifest.piWebapp?.backend?.entry, manifest.piWebapp?.frontend?.document, manifest.piWebapp?.frontend?.controller, manifest.piWebapp?.resourcesManifest].filter(Boolean);
  for (const entry of entrypoints) assert(files.includes(`package/${entry.replace(/^\.\//, '')}`), `Missing entrypoint ${entry}`);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      assert(!/^(workspace:|file:|link:)/.test(version), `Local dependency ${name} in ${expected.name}`);
      if (versions.has(name)) assert.equal(version, versions.get(name), `Incorrect workspace version for ${name}`);
    }
  }
  return manifest;
}

export async function packWorkspace(root, destination) {
  const packages = await readWorkspace(root);
  const versions = new Map(packages.map(pkg => [pkg.manifest.name, pkg.manifest.version]));
  const tarballs = [];
  for (const pkg of packages) {
    const before = new Set(await readdir(destination));
    timedSync(`pack ${pkg.manifest.name}`, () => execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: join(root, pkg.dir), stdio: 'pipe' }));
    const added = (await readdir(destination)).filter(file => file.endsWith('.tgz') && !before.has(file));
    assert.equal(added.length, 1, `Expected one tarball for ${pkg.manifest.name}`);
    const path = join(destination, added[0]);
    timedSync(`archive validation ${pkg.manifest.name}`, () => validatePackedPackage(path, pkg.manifest, versions));
    tarballs.push({ name: pkg.manifest.name, path });
  }
  return tarballs;
}

/** Install the exact archives outside the checkout, including Pi's external peers. */
export async function verifyInstallation(root, tarballs) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-package-install-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
    const plugin = JSON.parse(await readFile(join(root, 'packages/plan-mode/package.json'), 'utf8'));
    const workspace = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const dependencies = ['@earendil-works/pi-coding-agent', 'typebox', 'react'].map(name => `${name}@${plugin.devDependencies[name]}`);
    dependencies.push(`jsdom@${workspace.devDependencies.jsdom}`);
    timedSync('standalone npm install', () => execFileSync('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--prefer-offline', ...tarballs.map(item => item.path), ...dependencies], { cwd: directory, stdio: 'pipe', timeout: 180000 }));
    const smoke = `import assert from 'node:assert/strict';
      import React from 'react';
      import { JSDOM } from 'jsdom';
      import { isPiWebManifest } from '@chengzhiyi/pi-web-protocol';
      import extension from './node_modules/@chengzhiyi/pi-plan-mode/dist/extension.js';
      import { readFile } from 'node:fs/promises';
      const manifest = JSON.parse(await readFile('./node_modules/@chengzhiyi/pi-plan-mode/package.json', 'utf8'));
      assert(isPiWebManifest(manifest.piWebapp));
      assert.equal(typeof extension, 'function');
      const dom = new JSDOM('<!doctype html><html><body></body></html>');
      globalThis.document = dom.window.document;
      globalThis.window = dom.window;
      globalThis.__PI_WEBAPP_REACT__ = React;
      const { default: client } = await import('./node_modules/@chengzhiyi/pi-plan-mode/dist/client.js');
      assert.equal(client.id, manifest.name);
      assert.equal(client.apiVersion, 1);
      assert.equal(typeof client.activate, 'function');
      dom.window.close();
      console.log('Standalone package installation and both plugin entrypoints passed');`;
    await writeFile(join(directory, 'smoke.mjs'), smoke);
    timedSync('installed plugin smoke', () => execFileSync(process.execPath, ['smoke.mjs'], { cwd: directory, stdio: 'inherit', timeout: 30000 }));
    if (tarballs.some(item => item.name === '@chengzhiyi/pi-excalidraw')) {
      await writeFile(join(directory, 'hosted-smoke.mjs'), `import assert from 'node:assert/strict';
        import { readFile } from 'node:fs/promises';
        import { createRuntime } from '@chengzhiyi/pi-excalidraw';
        const manifest = JSON.parse(await readFile('./node_modules/@chengzhiyi/pi-excalidraw/package.json', 'utf8'));
        assert.equal(manifest.piWebapp.apiVersion, 2);
        let state = null;
        const runtime = await createRuntime({pluginId: 'excalidraw', version: manifest.version, generation: 1,
          broker: {async call(method, input) {
            if (method === 'state.read') return structuredClone(state);
            if (method === 'legacy.read') return null;
            if (method === 'state.compareAndSwap') {
              assert.equal(input.expectedRevision, state?.revision ?? 0);
              return state = {revision: input.expectedRevision + 1, schema: input.schema, value: structuredClone(input.value)};
            }
            throw new Error('Unexpected broker call: ' + method);
          }}});
        assert.equal((await runtime.health()).ok, true);
        assert.equal((await runtime.describe()).tools.length, 6);
        const request = {requestId: 'archive-smoke', generation: 1, kind: 'action',
          scope: {cwd: process.cwd(), workspaceId: 'archive', sessionId: 'archive'}, action: 'new', input: {}};
        const draft = await runtime.invoke(request);
        assert.equal(state.revision, 1);
        assert.equal((await runtime.invoke({...request, action: 'get', input: {id: draft.id}})).id, draft.id);
        await assert.rejects(runtime.invoke({...request, generation: 0}), /Stale/);
        await runtime.dispose();
        assert.equal((await runtime.health()).ok, false);
        await assert.rejects(runtime.invoke(request), /disposed/);
        console.log('Installed hosted v2 archive runtime, state CAS and lifecycle passed');`);
      timedSync('installed hosted smoke', () => execFileSync(process.execPath, ['hosted-smoke.mjs'], { cwd: directory, stdio: 'inherit', timeout: 30000 }));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  const destination = await mkdtemp(join(tmpdir(), 'pi-package-pack-'));
  try {
    const tarballs = await packWorkspace(root, destination);
    await verifyInstallation(root, tarballs);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}
