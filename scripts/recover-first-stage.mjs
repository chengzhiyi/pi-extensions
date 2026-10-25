import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Recovery is deliberately bound to the one ambiguous request, not a new stage submission.
export const recoveryTarget = Object.freeze({
  name: '@chengzhiyi/pi-excalidraw', version: '0.1.0', runId: '40184840188', runAttempt: '1',
  source: '59744894fabacf5cc9ef5182fe8889f2a14f2006',
  fingerprint: 'fbb5547bff4df89457a16f1af49a3e3476e6cdc52044b5c1d1160d3b7829cb18',
  sha256: 'c7aeef4d1546b5f0dec9743319f68b1cda217ffef60d53f9b8c66e754359c583',
});
const hash = (algorithm, bytes, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const stageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function selectRecoveryStage(items, intent) {
  assert(Array.isArray(items), 'Expected npm stage list JSON array');
  const matches = items.filter(item => item.packageName === intent.name && item.version === intent.version && item.shasum === intent.shasum);
  assert.equal(matches.length, 1, 'Expected exactly one matching stage; do not retry publishing');
  const item = matches[0];
  assert(stageIdPattern.test(item.id), 'Invalid stage ID');
  // npm's queue API names the unpromoted state "staged", not "pending".
  assert.equal(item.status, 'staged', 'Stage must still be staged for human approval');
  return item;
}
export function verifyRecoveryArchive(bytes, intent) {
  assert.equal(hash('sha256', bytes), intent.sha256, 'Recovered archive differs from original CI archive');
  assert.equal(`sha512-${hash('sha512', bytes, 'base64')}`, intent.integrity, 'Recovered SHA512 mismatch');
  assert.equal(hash('sha1', bytes), intent.shasum, 'Recovered SHA1 mismatch');
  assert.equal(bytes.length, intent.bytes, 'Recovered size mismatch');
}
export async function recoverFirstStage(input, destination, {
  execute = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 60000 }),
} = {}) {
  const folders = (await readdir(input, { withFileTypes: true })).filter(entry => entry.isDirectory());
  assert.equal(folders.length, 1, 'Expected exact source run artifact with one archive directory');
  const source = join(input, folders[0].name);
  const intent = JSON.parse(await readFile(join(source, 'first-publication-stage.json'), 'utf8'));
  assert.equal(intent.schema, 'pi-extensions.staging.v1');
  assert.equal(intent.status, 'stage-unconfirmed');
  for (const [key, value] of Object.entries(recoveryTarget)) assert.equal(intent[key], value, `Unexpected recovery ${key}`);
  assert.equal(intent.archive, 'chengzhiyi-pi-excalidraw-0.1.0.tgz');
  verifyRecoveryArchive(await readFile(join(source, intent.archive)), intent);
  await mkdir(destination, { recursive: true });
  const save = (name, value) => writeFile(join(destination, name), `${JSON.stringify(value, null, 2)}\n`);
  const items = JSON.parse(await execute(['stage', 'list', intent.name, '--json'], destination));
  // Retain only this package's rows, never another package's private queue.
  await save('stage-list.json', items.filter(item => item.packageName === intent.name));
  const selected = selectRecoveryStage(items, intent);
  const detail = JSON.parse(await execute(['stage', 'view', selected.id, '--json'], destination));
  await save('stage-detail.json', detail);
  assert.equal(selectRecoveryStage([detail], intent).id, selected.id);
  await execute(['stage', 'download', selected.id, '--json'], destination);
  const archives = (await readdir(destination)).filter(name => name.endsWith('.tgz'));
  assert.equal(archives.length, 1, 'Expected one downloaded stage archive');
  verifyRecoveryArchive(await readFile(join(destination, archives[0])), intent);
  const receipt = { ...intent, status: 'awaiting-promotion', stageId: selected.id,
    recoveredByRunId: process.env.GITHUB_RUN_ID, recovery: 'read-only list/view/download; exact archive verified against original CI artifact' };
  delete receipt.instruction;
  await save('recovered-stage.json', receipt);
  console.log(`Exact stage ${selected.id} recovered for ${intent.name}@${intent.version}. NOT PUBLISHED. Human 2FA approval required.`);
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await recoverFirstStage(resolve(process.argv[2]), resolve(process.argv[3]));
}
