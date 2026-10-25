import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPublishedPackage } from './release.mjs';
import { readWorkspace } from './workspace.mjs';

/** Existing packages use OIDC; new names require an explicit one-shot staging run and scoped token. */
export async function publishingReadiness(names, { lookup = readPublishedPackage, hasToken = false, stageNewPackages = false } = {}) {
  const missing = (await Promise.all(names.map(async name => await lookup(name) ? null : name))).filter(Boolean);
  return { ready: missing.length === 0 || (hasToken && stageNewPackages), missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packages = await readWorkspace(process.cwd());
  const { ready, missing } = await publishingReadiness(packages.map(pkg => pkg.manifest.name), {
    hasToken: Boolean(process.env.NPM_TOKEN),
    stageNewPackages: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.CI_STAGE_NEW_PACKAGES === 'true',
  });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
  if (!ready) {
    const message = `npm publication is waiting for first-package setup: ${missing.join(', ')}. Inspect npm Staged Packages and previous release artifacts before retrying. A new name requires a scoped NPM_TOKEN and an explicit workflow_dispatch with stage_new_packages=true. CI stages the exact archive for human 2FA promotion; it does not directly publish a new name. After promotion configure Trusted Publishing and resume CI without the staging flag. All build, test and package checks passed; no package was published by this job.`;
    console.log(`::warning::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### npm initialization required\n\n${message}\n`);
  }
}
