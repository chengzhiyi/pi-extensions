import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export function validateStageReceipt(output, expected) {
  const receipt = JSON.parse(output);
  assert(receipt && !Array.isArray(receipt), 'Expected one npm stage receipt');
  assert.equal(receipt.name, expected.name, 'Staged package name mismatch');
  assert.equal(receipt.version, expected.version, 'Staged package version mismatch');
  assert.equal(receipt.integrity, expected.integrity, 'Staged archive integrity mismatch');
  assert.equal(receipt.shasum, expected.shasum, 'Staged archive shasum mismatch');
  assert(typeof receipt.stageId === 'string' && /^[\w.:-]{1,256}$/.test(receipt.stageId), 'Missing or invalid stage ID');
  return receipt;
}

/** A stage is not a publication. Save intent BEFORE the request to make ambiguous failures inspectable. */
export async function stageArchive(item, archive, { source, destination, runId, runAttempt,
  execute = (args, env) => execFileSync('npm', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 180000 }),
  environment = process.env } = {}) {
  const bytes = await readFile(archive);
  const expected = { name: item.name, version: item.version,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex') };
  const intent = { schema: 'pi-extensions.staging.v1', status: 'stage-requested', ...expected,
    fingerprint: item.fingerprint, source, archive: basename(archive), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), runId, runAttempt };
  const path = join(destination, 'first-publication-stage.json');
  const save = data => writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  await save(intent);
  try {
    const result = validateStageReceipt(await execute(['stage', 'publish', archive, '--access', 'public', '--tag', 'latest', '--json'], environment), expected);
    const receipt = { ...intent, status: 'awaiting-promotion', stageId: result.stageId };
    await save(receipt);
    return receipt;
  } catch (error) {
    await save({ ...intent, status: 'stage-unconfirmed', instruction: 'Inspect npm Staged Packages and this exact archive before any retry; a failed command may have reached npm.' });
    throw error;
  }
}
