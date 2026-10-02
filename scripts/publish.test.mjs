import assert from 'node:assert/strict';
import test from 'node:test';
import { publishInOrder, runRelease } from './publish.mjs';

const plan = [
  { name: 'protocol', version: '0.1.1', fingerprint: 'protocol', publish: true },
  { name: 'plugin', version: '0.1.1', fingerprint: 'plugin', publish: true },
];
const receipt = item => ({ version: item.version, piRelease: { fingerprint: item.fingerprint } });

test('failed protocol publication prevents dependent publication', async () => {
  const published = [];
  await assert.rejects(publishInOrder(plan, item => { published.push(item.name); throw new Error('auth failed'); }, () => null), /auth failed/);
  assert.deepEqual(published, ['protocol']);
});

test('an ambiguous npm failure with a confirmed receipt continues without another publish', async () => {
  const published = [];
  await publishInOrder(plan, item => { published.push(item.name); if (item.name === 'protocol') throw new Error('lost response'); }, receipt);
  assert.deepEqual(published, ['protocol', 'plugin']);
});

test('a matching version without matching content is not accepted as successful', async () => {
  await assert.rejects(publishInOrder(plan, () => {}, item => ({ version: item.version, piRelease: { fingerprint: 'other-content' } })), /not confirmed/);
});

test('unchanged packages are never published', async () => {
  await publishInOrder(plan.map(item => ({ ...item, publish: false })), () => assert.fail('unexpected publish'), () => assert.fail('unexpected confirmation'));
});

test('publishing outside the main GitHub Actions job fails before reading or changing files', async t => {
  const previous = process.env.GITHUB_REF;
  process.env.GITHUB_REF = 'refs/heads/not-main';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_REF; else process.env.GITHUB_REF = previous; });
  await assert.rejects(runRelease('--publish', '/does-not-exist'), /restricted/);
});
