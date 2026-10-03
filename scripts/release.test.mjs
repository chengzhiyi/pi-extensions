import assert from 'node:assert/strict';
import test from 'node:test';
import { planReleases, readPublishedPackage } from './release.mjs';

const protocol = { dir: 'packages/protocol', fingerprint: 'protocol-source', manifest: { name: '@test/protocol', version: '0.1.0' } };
const plugin = { dir: 'packages/plugin', fingerprint: 'plugin-source', manifest: { name: '@test/plugin', version: '0.1.0', dependencies: { '@test/protocol': 'workspace:*' } } };
const initial = () => planReleases([plugin, protocol], {});
const publishedFrom = plan => Object.fromEntries(plan.map(item => [item.name, { version: item.version, piRelease: { fingerprint: item.fingerprint } }]));

test('first publication preserves source versions and orders dependencies first', () => {
  assert.deepEqual(initial().map(item => [item.name, item.version, item.publish]), [
    ['@test/protocol', '0.1.0', true], ['@test/plugin', '0.1.0', true],
  ]);
});

test('unchanged published content does not release or loop after version synchronization', () => {
  const first = initial();
  const synced = [protocol, plugin].map(pkg => ({ ...pkg, manifest: { ...pkg.manifest, piRelease: { source: 'sync-commit' } } }));
  assert.deepEqual(planReleases(synced, publishedFrom(first)).map(item => item.publish), [false, false]);
});

test('a plugin-only change increments only the plugin patch', () => {
  const plan = planReleases([protocol, { ...plugin, fingerprint: 'changed-plugin' }], publishedFrom(initial()));
  assert.deepEqual(plan.map(item => [item.version, item.publish]), [['0.1.0', false], ['0.1.1', true]]);
});

test('protocol changes bump and repin dependent plugins even when their source is unchanged', () => {
  const plan = planReleases([{ ...protocol, fingerprint: 'changed-protocol' }, plugin], publishedFrom(initial()));
  assert.deepEqual(plan.map(item => [item.version, item.publish]), [['0.1.1', true], ['0.1.1', true]]);
  assert.deepEqual(plan[1].dependencyVersions, { '@test/protocol': '0.1.1' });
});

test('partial publication retries retain the pending version and skip the completed protocol', () => {
  const packages = [{ ...protocol, fingerprint: 'new-protocol' }, plugin];
  const registry = publishedFrom(initial());
  const firstAttempt = planReleases(packages, registry);
  registry['@test/protocol'] = publishedFrom(firstAttempt)['@test/protocol'];
  const retry = planReleases(packages, registry);
  assert.equal(retry[0].publish, false);
  assert.equal(retry[1].publish, true);
  assert.equal(retry[1].version, firstAttempt[1].version);
  assert.equal(retry[1].fingerprint, firstAttempt[1].fingerprint);
});

test('manual minor/major increases are respected and stale source versions never downgrade npm', () => {
  const registry = publishedFrom(initial());
  assert.equal(planReleases([{ ...protocol, manifest: { ...protocol.manifest, version: '1.0.0' } }], registry)[0].version, '1.0.0');
  registry['@test/protocol'].version = '0.1.9';
  assert.equal(planReleases([protocol], registry)[0].version, '0.1.9');
  assert.equal(planReleases([{ ...protocol, fingerprint: 'changed' }], registry)[0].version, '0.1.10');
});

test('cycles, missing workspace dependencies and prerelease versions fail before publication', () => {
  const a = { ...protocol, manifest: { ...protocol.manifest, dependencies: { '@test/plugin': 'workspace:*' } } };
  assert.throws(() => planReleases([a, plugin], {}), /cycle/i);
  assert.throws(() => planReleases([plugin], {}), /missing/i);
  assert.throws(() => planReleases([{ ...protocol, manifest: { ...protocol.manifest, version: '0.2.0-beta.1' } }], {}), /stable/i);
});

test('a moved latest tag cannot cause reuse of an already published stable version', () => {
  const registry = publishedFrom(initial());
  registry['@test/protocol'].highestVersion = '0.1.8';
  const next = planReleases([{ ...protocol, fingerprint: 'changed-protocol' }], registry);
  assert.equal(next[0].version, '0.1.9');
});

test('registry treats only missing packages as first releases and fails closed on outages', async () => {
  const missing = await readPublishedPackage('@test/protocol', async () => new Response('', { status: 404 }));
  assert.equal(missing, null);
  await assert.rejects(readPublishedPackage('@test/protocol', async () => new Response('', { status: 503 })), /503/);
  await assert.rejects(readPublishedPackage('@test/protocol', async () => new Response('', { status: 401 })), /401/);
  await assert.rejects(readPublishedPackage('@test/protocol', async () => Response.json({ versions: {} })), /latest/i);
});

test('release lookup revalidates metadata instead of accepting a cached pre-publication 404', async () => {
  const metadata = { 'dist-tags': { latest: '0.1.0' }, versions: {
    '0.1.0': { version: '0.1.0', piRelease: { fingerprint: 'confirmed' } },
    '0.1.1': { version: '0.1.1' },
  } };
  const result = await readPublishedPackage('@test/protocol', async url => {
    const query = new URL(url).searchParams;
    return query.has('release-check') ? Response.json(metadata) : new Response('', { status: 404 });
  });
  assert.equal(result?.version, '0.1.0');
  assert.equal(result?.highestVersion, '0.1.1');
  assert.equal(result?.piRelease.fingerprint, 'confirmed');
});
