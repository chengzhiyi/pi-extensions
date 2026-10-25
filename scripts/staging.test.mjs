import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageArchive, validateStageReceipt } from './staging.mjs';

const bytes = Buffer.from('exact fixture archive bytes');
const item = { name: '@fixture/new-plugin', version: '0.1.0', fingerprint: 'fixture-content' };
const expected = { name: item.name, version: item.version,
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  shasum: createHash('sha1').update(bytes).digest('hex') };
const ack = { ...expected, stageId: 'fixture-stage-123' };

async function fixture(t) {
  const destination = await mkdtemp(join(tmpdir(), 'pi-staging-test-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  const archive = join(destination, 'fixture.tgz');
  await writeFile(archive, bytes);
  return { destination, archive, source: 'fixture-source', runId: '123', runAttempt: '1' };
}

test('npm stage acknowledgement requires exact name, version, integrity, shasum and stage ID', () => {
  assert.deepEqual(validateStageReceipt(JSON.stringify(ack), expected), ack);
  for (const field of ['name', 'version', 'integrity', 'shasum', 'stageId']) {
    assert.throws(() => validateStageReceipt(JSON.stringify({ ...ack, [field]: '' }), expected));
  }
  assert.throws(() => validateStageReceipt(JSON.stringify({ ...ack, stageId: 'inject\npublished=true' }), expected));
  assert.throws(() => validateStageReceipt('[]', expected));
  assert.throws(() => validateStageReceipt('{broken', expected));
});

test('staging preserves intent before exactly one stage request and saves exact artifact receipt', async t => {
  const options = await fixture(t);
  let calls = 0;
  const environment = { NODE_AUTH_TOKEN: 'fixture-only' };
  const result = await stageArchive(item, options.archive, { ...options, environment, execute: async (args, env) => {
    calls++;
    assert.deepEqual(args, ['stage', 'publish', options.archive, '--access', 'public', '--tag', 'latest', '--json']);
    assert.equal(env, environment);
    const intent = JSON.parse(await readFile(join(options.destination, 'first-publication-stage.json'), 'utf8'));
    assert.equal(intent.status, 'stage-requested');
    assert.equal(intent.integrity, expected.integrity);
    assert.equal(intent.source, 'fixture-source');
    return JSON.stringify(ack);
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'awaiting-promotion');
  assert.equal(result.stageId, ack.stageId);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.bytes, bytes.length);
  assert.equal(result.fingerprint, item.fingerprint);
  const saved = await readFile(join(options.destination, 'first-publication-stage.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), result);
  assert(!saved.includes('fixture-only'), 'Credentials must not enter the durable receipt');
});

for (const mode of ['transport-failure', 'bad-receipt', 'no-stage-id']) {
  test(`staging ${mode} saves ambiguity and never retries or reports published`, async t => {
    const options = await fixture(t);
    let calls = 0;
    await assert.rejects(stageArchive(item, options.archive, { ...options, execute: () => {
      calls++;
      if (mode === 'transport-failure') throw new Error('lost response');
      return JSON.stringify({ ...ack, ...(mode === 'bad-receipt' ? { integrity: 'different' } : { stageId: null }) });
    } }));
    assert.equal(calls, 1);
    const saved = JSON.parse(await readFile(join(options.destination, 'first-publication-stage.json'), 'utf8'));
    assert.equal(saved.status, 'stage-unconfirmed');
    assert.equal(saved.stageId, undefined);
    assert.equal(saved.integrity, expected.integrity);
    assert(saved.instruction.includes('before any retry'));
  });
}

test('CI retains exact artifacts and only syncs manifests after full publication', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /id: release\n\s+run: pnpm release/);
  assert.match(workflow, /if: always\(\)\n\s+uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /name: Sync confirmed release versions to main\n\s+if: steps.release.outputs.published == 'true'/);
});
