import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmPublication, publicationEnvironment, publishInOrder, runRelease } from './publish.mjs';

const plan = [
  { name: 'protocol', version: '0.1.1', fingerprint: 'protocol', publish: true },
  { name: 'plugin', version: '0.1.1', fingerprint: 'plugin', publish: true },
];
const receipt = item => ({ version: item.version, piRelease: { fingerprint: item.fingerprint } });

test('publication confirmation waits for asynchronous registry processing', async () => {
  let elapsed = 0;
  const result = await confirmPublication(plan[0], {
    lookup: async () => elapsed < 240000 ? null : receipt(plan[0]),
    wait: async ms => { elapsed += ms; },
  });
  assert.deepEqual(result, receipt(plan[0]));
  assert.equal(elapsed, 240000);
});

test('publication confirmation is bounded and rejects a different receipt', async () => {
  let elapsed = 0;
  const result = await confirmPublication(plan[0], {
    lookup: async () => ({ version: '0.1.1', piRelease: { fingerprint: 'other' } }),
    wait: async ms => { elapsed += ms; },
    attempts: 3,
  });
  assert.equal(result, null);
  assert.equal(elapsed, 30000);
});

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

test('existing packages use tokenless OIDC without leaking or mutating bootstrap credentials', () => {
  const environment = { NODE_AUTH_TOKEN: 'fixture-bootstrap', NPM_TOKEN: 'fixture-bootstrap', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-oidc', PATH: '/fixture/bin' };
  const result = publicationEnvironment({ name: 'protocol', latest: { version: '0.1.0' } }, environment);
  assert.equal(result.NODE_AUTH_TOKEN, '');
  assert.equal('NPM_TOKEN' in result, false);
  assert.equal(result.ACTIONS_ID_TOKEN_REQUEST_URL, environment.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert.equal(result.ACTIONS_ID_TOKEN_REQUEST_TOKEN, environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  assert.equal(result.PATH, environment.PATH);
  assert.equal(environment.NODE_AUTH_TOKEN, 'fixture-bootstrap');
  assert.equal(environment.NPM_TOKEN, 'fixture-bootstrap');
});

test('new package keeps the CI bootstrap token and cannot silently assume OIDC initialization', () => {
  const environment = { NODE_AUTH_TOKEN: 'fixture-bootstrap', PATH: '/fixture/bin' };
  const result = publicationEnvironment({ name: 'new-plugin', latest: null }, environment);
  assert.deepEqual(result, environment);
  assert.notEqual(result, environment);
  assert.throws(() => publicationEnvironment({ name: 'new-plugin', latest: null }, {}), /First publication requires CI authentication for new-plugin/);
  assert.throws(() => publicationEnvironment({ name: 'new-plugin', latest: null }, { NODE_AUTH_TOKEN: '' }), /First publication requires/);
});

test('publishing outside the main GitHub Actions job fails before reading or changing files', async t => {
  const previous = process.env.GITHUB_REF;
  process.env.GITHUB_REF = 'refs/heads/not-main';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_REF; else process.env.GITHUB_REF = previous; });
  await assert.rejects(runRelease('--publish', '/does-not-exist'), /restricted/);
});
