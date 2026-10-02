import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function readWorkspace(root, repository = process.env.GITHUB_REPOSITORY) {
  if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid GitHub repository');
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const shared = JSON.stringify({ packageManager: rootManifest.packageManager, dependencies: rootManifest.dependencies, devDependencies: rootManifest.devDependencies });
  const sharedFiles = files.filter(file => ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'tsconfig.json'].includes(file));
  const packages = [];
  for (const directory of (await readdir(join(root, 'packages'), { withFileTypes: true })).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = `packages/${directory.name}`;
    const manifest = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8'));
    if (manifest.private) continue;
    if (repository) manifest.repository = { type: 'git', url: `git+https://github.com/${repository}.git`, directory: dir };
    const normalized = { ...manifest };
    delete normalized.version;
    delete normalized.piRelease;
    const hash = createHash('sha256').update(shared).update(JSON.stringify(normalized));
    const inputs = files.filter(file => file.startsWith(`${dir}/`) && file !== `${dir}/package.json` && !/\/(test|tests|dist|node_modules|artifacts)(\/|$)/.test(file));
    for (const file of [...sharedFiles, ...inputs]) {
      hash.update(file).update('\0').update(await readFile(join(root, file))).update('\0');
    }
    packages.push({ dir, manifest, fingerprint: hash.digest('hex') });
  }
  return packages;
}
