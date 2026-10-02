import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { packWorkspace, verifyInstallation } from './pack.mjs';
import { planReleases, readPublishedPackage } from './release.mjs';
import { readWorkspace } from './workspace.mjs';

function matches(item, published) {
  return published?.version === item.version && published.piRelease?.fingerprint === item.fingerprint;
}

export async function publishInOrder(plan, publish, confirm) {
  for (const item of plan.filter(item => item.publish)) {
    let failure;
    try { await publish(item); } catch (error) { failure = error; }
    // A failed command can still have reached npm. Confirm before retrying or
    // publishing a dependent, rather than allocating another version blindly.
    if (!matches(item, await confirm(item))) throw failure ?? new Error(`Publication not confirmed for ${item.name}@${item.version}`);
  }
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
  await publishInOrder(plan, item => {
    execFileSync('npm', ['publish', archives.get(item.name), '--access', 'public', '--tag', 'latest'], { cwd: root, stdio: 'inherit' });
  }, async item => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = await readPublishedPackage(item.name);
      if (matches(item, current)) return current;
      if (attempt < 11) await setTimeout(2000);
    }
    return null;
  });
  console.log('All planned publications confirmed; manifests are ready to sync to main');
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runRelease(process.argv[2]);
}
