import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export function validateStageReceipt(output, expected) {
  const envelope = JSON.parse(output);
  assert(envelope && !Array.isArray(envelope) && typeof envelope === 'object', 'Expected one npm stage receipt');
  // npm 11 logTar buffers JSON under the package-name key, not as a flat object.
  assert.deepEqual(Object.keys(envelope), [expected.name], 'Expected exactly one package in npm stage output');
  const receipt = envelope[expected.name];
  assert(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'Invalid npm stage receipt');
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
  const saveOutput = async output => {
    let text = String(output ?? '');
    for (const secret of [environment.NODE_AUTH_TOKEN, environment.NPM_TOKEN]) {
      if (secret) text = text.split(secret).join('[REDACTED]');
    }
    await writeFile(join(destination, 'first-publication-stage-output.json'), text);
  };
  try {
    const output = await execute(['stage', 'publish', archive, '--access', 'public', '--tag', 'latest', '--json'], environment);
    await saveOutput(output);
    const result = validateStageReceipt(output, expected);
    const receipt = { ...intent, status: 'awaiting-promotion', stageId: result.stageId };
    await save(receipt);
    return receipt;
  } catch (error) {
    if (error.stdout) await saveOutput(error.stdout);
    await save({ ...intent, status: 'stage-unconfirmed', instruction: 'Inspect npm Staged Packages and this exact archive before any retry; a failed command may have reached npm.' });
    throw error;
  }
}
