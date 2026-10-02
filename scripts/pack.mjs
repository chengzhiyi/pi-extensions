import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWorkspace } from './workspace.mjs';

export function validatePackedPackage(tarball, expected, versions) {
  const files = execFileSync('tar', ['-tf', tarball], { encoding: 'utf8' }).trim().split('\n');
  assert(files.every(file => file.endsWith('/') || /^package\/(package\.json|README\.md|LICENSE|NOTICE\.txt|dist\/[^/]+\.(js|css|d\.ts))$/.test(file)), `Unexpected files in ${expected.name}`);
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(manifest.name, expected.name);
  assert.equal(manifest.version, expected.version);
  assert(files.includes('package/LICENSE'), `Missing license in ${expected.name}`);
  const entrypoints = [manifest.main, manifest.types, ...(manifest.pi?.extensions ?? []), manifest.piWebapp?.client, manifest.piWebapp?.style].filter(Boolean);
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
    execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: join(root, pkg.dir), stdio: 'pipe' });
    const added = (await readdir(destination)).filter(file => file.endsWith('.tgz') && !before.has(file));
    assert.equal(added.length, 1, `Expected one tarball for ${pkg.manifest.name}`);
    const path = join(destination, added[0]);
    validatePackedPackage(path, pkg.manifest, versions);
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
    execFileSync('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', ...tarballs.map(item => item.path), ...dependencies], { cwd: directory, stdio: 'pipe', timeout: 180000 });
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
    execFileSync(process.execPath, ['smoke.mjs'], { cwd: directory, stdio: 'inherit', timeout: 30000 });
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
