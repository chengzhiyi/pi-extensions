import { createHash } from 'node:crypto';

const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function parts(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Expected a stable version, got ${version}`);
  return version.split('.').map(Number);
}

function newer(left, right) {
  const a = parts(left), b = parts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Registry fingerprints remain available even if a run dies before syncing Git. */
export function planReleases(packages, published) {
  const byName = new Map(packages.map(pkg => [pkg.manifest.name, pkg]));
  if (byName.size !== packages.length) throw new Error('Duplicate workspace package names');
  const visiting = new Set(), planned = new Map();
  function visit(pkg) {
    const name = pkg.manifest.name;
    if (planned.has(name)) return planned.get(name);
    if (visiting.has(name)) throw new Error(`Workspace dependency cycle at ${name}`);
    visiting.add(name);
    const dependencyVersions = {};
    for (const field of dependencyFields) {
      for (const [dependency, range] of Object.entries(pkg.manifest[field] ?? {}).sort()) {
        if (range.startsWith('workspace:') && !byName.has(dependency)) throw new Error(`Missing workspace dependency ${dependency}`);
        if (byName.has(dependency)) dependencyVersions[dependency] = visit(byName.get(dependency)).version;
      }
    }
    const fingerprint = digest([pkg.fingerprint, dependencyVersions]);
    const latest = published[name];
    parts(pkg.manifest.version);
    if (latest) parts(latest.version);
    const publish = !latest || latest.piRelease?.fingerprint !== fingerprint || newer(pkg.manifest.version, latest.version);
    let version = latest?.version ?? pkg.manifest.version;
    if (publish && latest) {
      const highest = latest.highestVersion ?? latest.version;
      const [major, minor, patch] = parts(highest);
      version = newer(pkg.manifest.version, highest) ? pkg.manifest.version : `${major}.${minor}.${patch + 1}`;
    }
    const item = { ...pkg, name, fingerprint, dependencyVersions, version, publish, latest };
    planned.set(name, item);
    visiting.delete(name);
    return item;
  }
  for (const pkg of packages) visit(pkg);
  return [...planned.values()];
}

export async function readPublishedPackage(name, request = fetch) {
  // npm edges can retain the 404 from before a first publish, or an older
  // version list. Release planning and confirmation must see fresh metadata.
  const url = new URL(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
  url.searchParams.set('release-check', String(Date.now()));
  const response = await request(url.href, { signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry lookup failed for ${name}: HTTP ${response.status}`);
  const metadata = await response.json();
  const latest = metadata.versions?.[metadata['dist-tags']?.latest];
  if (!latest) throw new Error(`Registry package ${name} has no usable latest version`);
  const highestVersion = Object.keys(metadata.versions).filter(version => /^\d+\.\d+\.\d+$/.test(version))
    .reduce((highest, version) => newer(version, highest) ? version : highest, latest.version);
  return { ...latest, highestVersion };
}
