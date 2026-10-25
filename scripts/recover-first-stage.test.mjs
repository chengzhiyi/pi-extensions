import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { selectRecoveryStage, verifyRecoveryArchive } from './recover-first-stage.mjs';

const bytes = Buffer.from('original exact CI fixture');
const hash = (algorithm, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const intent = { name: '@fixture/plugin', version: '0.1.0', sha256: hash('sha256'),
  integrity: `sha512-${hash('sha512', 'base64')}`, shasum: hash('sha1'), bytes: bytes.length };
const item = { id: '01234567-0123-0123-0123-0123456789ab', packageName: intent.name,
  version: intent.version, shasum: intent.shasum, status: 'pending' };

test('read-only recovery selects exactly one matching pending package/version/archive', () => {
  assert.deepEqual(selectRecoveryStage([item, { ...item, packageName: 'other' }], intent), item);
  for (const items of [[], [item, item], [{ ...item, version: '0.1.1' }], [{ ...item, shasum: 'different' }],
    [{ ...item, id: '../unsafe' }], [{ ...item, status: 'approved' }]]) {
    assert.throws(() => selectRecoveryStage(items, intent));
  }
});

test('read-only recovery verifies all original artifact hashes and size', () => {
  verifyRecoveryArchive(bytes, intent);
  assert.throws(() => verifyRecoveryArchive(Buffer.from('different'), intent));
  for (const key of ['sha256', 'shasum', 'integrity', 'bytes']) {
    assert.throws(() => verifyRecoveryArchive(bytes, { ...intent, [key]: null }));
  }
});

test('recovery workflow is manual main only, bound to original run, without release commands', async () => {
  const workflow = await readFile(new URL('../.github/workflows/recover-first-stage.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /run-id: 40184840188/);
  assert.doesNotMatch(workflow, /pnpm release|stage publish|stage approve|stage reject/);
  const script = await readFile(new URL('./recover-first-stage.mjs', import.meta.url), 'utf8');
  assert.match(script, /\['stage', 'list'/);
  assert.match(script, /\['stage', 'view'/);
  assert.match(script, /\['stage', 'download'/);
  assert.doesNotMatch(script, /\['stage', '(?:publish|approve|reject)'/);
});
