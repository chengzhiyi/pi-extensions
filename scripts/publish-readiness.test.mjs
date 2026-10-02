import assert from 'node:assert/strict';
import test from 'node:test';
import { publishingReadiness } from './publish-readiness.mjs';

test('new npm packages require bootstrap credentials, existing packages use OIDC', async () => {
  const packages = ['protocol', 'plugin'];
  const missing = async () => null;
  assert.deepEqual(await publishingReadiness(packages, { lookup: missing }), { ready: false, missing: packages });
  assert.equal((await publishingReadiness(packages, { lookup: missing, hasToken: true })).ready, true);
  assert.equal((await publishingReadiness(packages, { lookup: async () => ({ version: '0.1.0' }) })).ready, true);
});

test('partial bootstrap and registry failures cannot silently enable publishing', async () => {
  const result = await publishingReadiness(['protocol', 'plugin'], {
    lookup: async name => name === 'protocol' ? { version: '0.1.0' } : null,
  });
  assert.deepEqual(result, { ready: false, missing: ['plugin'] });
  await assert.rejects(publishingReadiness(['protocol'], { lookup: async () => { throw new Error('HTTP 503'); } }), /503/);
});
