import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPublishedPackage } from './release.mjs';
import { readWorkspace } from './workspace.mjs';

/** OIDC is configured on existing npm packages; new names need a first authenticated publication. */
export async function publishingReadiness(names, { lookup = readPublishedPackage, hasToken = false } = {}) {
  const missing = (await Promise.all(names.map(async name => await lookup(name) ? null : name))).filter(Boolean);
  return { ready: missing.length === 0 || hasToken, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packages = await readWorkspace(process.cwd());
  const { ready, missing } = await publishingReadiness(packages.map(pkg => pkg.manifest.name), { hasToken: Boolean(process.env.NPM_TOKEN) });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
  if (!ready) {
    const message = `npm publication is waiting for first-package setup: ${missing.join(', ')}. Complete the first authenticated publication locally or configure a temporary NPM_TOKEN secret, then configure Trusted Publishing and rerun this workflow. All build, test and package checks passed; no package was published.`;
    console.log(`::warning::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### npm initialization required\n\n${message}\n`);
  }
}
