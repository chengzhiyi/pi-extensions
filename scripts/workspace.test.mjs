import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readWorkspace } from './workspace.mjs';

test('fingerprints ignore root docs, tests, version-sync metadata and build outputs, but include shipped content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-release-fingerprint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  for (const dir of ['packages/example/src', 'packages/example/test', 'packages/example/dist']) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@10.18.1' }));
  const path = join(root, 'packages/example/package.json');
  await writeFile(path, JSON.stringify({ name: '@test/example', version: '0.1.0' }));
  await writeFile(join(root, 'packages/example/src/index.ts'), 'export const value = 1;');
  const original = (await readWorkspace(root))[0].fingerprint;
  await writeFile(join(root, 'README.md'), 'new repository documentation');
  await writeFile(join(root, 'packages/example/test/index.test.mjs'), 'test change');
  await writeFile(join(root, 'packages/example/dist/index.js'), 'generated');
  await symlink(root, join(root, 'packages/example/node_modules'), 'dir');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...manifest, version: '0.1.1', piRelease: { fingerprint: 'last-release', source: 'commit' } }));
  assert.equal((await readWorkspace(root))[0].fingerprint, original);
  await writeFile(join(root, 'packages/example/README.md'), 'shipped package documentation');
  assert.notEqual((await readWorkspace(root))[0].fingerprint, original);
  const beforeLock = (await readWorkspace(root))[0].fingerprint;
  await writeFile(join(root, 'pnpm-lock.yaml'), 'dependency changes');
  assert.notEqual((await readWorkspace(root))[0].fingerprint, beforeLock);
});

test('repository metadata is stable across CI synchronization and private packages are excluded', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-release-repository-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'packages/a'), { recursive: true });
  await mkdir(join(root, 'packages/private'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{}');
  await writeFile(join(root, 'packages/a/package.json'), JSON.stringify({ name: '@test/a', version: '0.1.0' }));
  await writeFile(join(root, 'packages/private/package.json'), JSON.stringify({ name: '@test/private', private: true }));
  const first = await readWorkspace(root, 'example/pi-extensions');
  assert.equal(first.length, 1);
  assert.equal(first[0].manifest.repository.directory, 'packages/a');
  await writeFile(join(root, 'packages/a/package.json'), JSON.stringify(first[0].manifest));
  assert.equal((await readWorkspace(root, 'example/pi-extensions'))[0].fingerprint, first[0].fingerprint);
});
