import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { packWorkspace, verifyInstallation } from './pack.mjs';
import { planReleases, readPublishedPackage } from './release.mjs';
import { readWorkspace } from './workspace.mjs';
import { stageArchive } from './staging.mjs';

function matches(item, published) {
  return published?.version === item.version && published.piRelease?.fingerprint === item.fingerprint;
}

export async function confirmPublication(item, { lookup = readPublishedPackage, wait = setTimeout, attempts = 60 } = {}) {
  // npm accepts a publish before asynchronous processing exposes its metadata.
  // Poll up to 60 times, 15 seconds apart; never advance without the exact receipt.
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await lookup(item.name);
    if (matches(item, current)) return current;
    if (attempt < attempts - 1) await wait(15000);
  }
  return null;
}

export async function publishInOrder(plan, publish, confirm, stage = null) {
  for (const item of plan.filter(item => item.publish)) {
    if (!item.latest && stage) {
      const receipt = await stage(item);
      return { status: 'awaiting-promotion', item: item.name, receipt };
    }
    let failure;
    try { await publish(item); } catch (error) { failure = error; }
    // A failed command can still have reached npm. Confirm before retrying or
    // publishing a dependent, rather than allocating another version blindly.
    if (!matches(item, await confirm(item))) throw failure ?? new Error(`Publication not confirmed for ${item.name}@${item.version}`);
  }
  return { status: 'published' };
}

/** Existing packages retain Trusted Publishing; the temporary token only stages new names. */
export function publicationEnvironment(item, environment = process.env) {
  const result = { ...environment };
  if (item.latest) {
    // setup-node's npmrc interpolates NODE_AUTH_TOKEN. Empty preserves the prior
    // tokenless OIDC path; passing the bootstrap token makes npm prefer it instead.
    result.NODE_AUTH_TOKEN = '';
    delete result.NPM_TOKEN;
  } else {
    assert(result.NODE_AUTH_TOKEN, `First publication requires CI authentication for ${item.name}`);
  }
  return result;
}

export function assertStagingOptIn(plan, environment = process.env) {
  if (!plan.some(item => item.publish && !item.latest)) return;
  assert(environment.GITHUB_EVENT_NAME === 'workflow_dispatch' && environment.CI_STAGE_NEW_PACKAGES === 'true',
    'New package staging requires an explicit workflow_dispatch with stage_new_packages=true; inspect prior staged receipts before retrying');
}

export async function runRelease(mode, root = process.cwd()) {
  assert(['--plan', '--prepare', '--publish'].includes(mode), 'Use --plan, --prepare or --publish');
  if (mode === '--publish') {
    assert(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_REPOSITORY,
      'Automated publishing is restricted to GitHub Actions on main');
  }
  const packages = await readWorkspace(root);
  const published = Object.fromEntries(await Promise.all(packages.map(async pkg => [pkg.manifest.name, await readPublishedPackage(pkg.manifest.name)])));
  const plan = planReleases(packages, published);
  console.table(plan.map(item => ({ package: item.name, version: item.version, action: item.publish ? 'publish' : 'unchanged' })));
  if (mode === '--plan') return plan;
  if (mode === '--publish') assertStagingOptIn(plan);
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  for (const item of plan) {
    const manifest = { ...item.manifest, version: item.version,
      piRelease: item.publish ? { fingerprint: item.fingerprint, source } : item.latest.piRelease };
    const path = join(root, item.dir, 'package.json');
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    if (await readFile(path, 'utf8') !== text) await writeFile(path, text);
  }
  // workspace:* remains a local link in source. pnpm pack pins it to the chosen
  // protocol version in the archives installed and published below.
  const destination = join(root, 'artifacts', 'release', `${Date.now()}`);
  await mkdir(destination, { recursive: true });
  const tarballs = await packWorkspace(root, destination);
  await verifyInstallation(root, tarballs);
  if (mode === '--prepare') {
    console.log(`Prepared release archives in ${destination}; nothing published`);
    return plan;
  }
  const archives = new Map(tarballs.map(item => [item.name, item.path]));
  const result = await publishInOrder(plan, item => {
    assert(item.latest, 'New package names must use staged publication');
    const env = publicationEnvironment(item);
    console.log(`Publishing ${item.name}: Trusted Publishing (OIDC)`);
    execFileSync('npm', ['publish', archives.get(item.name), '--access', 'public', '--tag', 'latest'], { cwd: root, stdio: 'inherit', env });
  }, item => confirmPublication(item), item => {
    console.log(`Staging ${item.name}@${item.version}; human 2FA promotion is required before installation or dependent publishing`);
    return stageArchive(item, archives.get(item.name), { source, destination,
      runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      environment: publicationEnvironment(item) });
  });
  await writeFile(join(root, 'artifacts', 'release', 'publication-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `published=${result.status === 'published'}\n`);
  if (result.status === 'awaiting-promotion') {
    const message = `Awaiting human promotion: ${result.item}, stage ID ${result.receipt.stageId}. STAGED ONLY, NOT PUBLISHED.\nReview the exact receipt and archive in the release artifact, then approve in npm Staged Packages with 2FA.\nNo dependent publications or manifest sync ran. After promotion, configure this package's Trusted Publisher before resuming main CI.\n`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message);
  } else {
    console.log('All planned publications confirmed; manifests are ready to sync to main');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runRelease(process.argv[2]);
}
