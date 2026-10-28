import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Preflight every member before extracting into a private directory, never the checkout.
 * Three archive passes replace one full gzip scan and subprocess per resource.
 */
export function withPackedFiles(tarball, inspect) {
  const archive = resolve(tarball);
  const files = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trimEnd().split('\n');
  const listing = execFileSync('tar', ['-tvf', archive], { encoding: 'utf8' }).trimEnd().split('\n');
  assert.equal(new Set(files).size, files.length, 'Duplicate tar members');
  assert.equal(listing.length, files.length, 'Invalid archive listing');
  assert(listing.every(line => /^[d-]/.test(line)), 'Links and special archive members are forbidden');
  for (const file of files) {
    const parts = file.replace(/\/$/, '').split('/');
    assert(parts[0] === 'package' && parts.every(part => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..'), 'Unsafe archive path');
  }
  const directory = mkdtempSync(join(tmpdir(), 'pi-archive-inspect-'));
  try {
    execFileSync('tar', ['-xf', archive, '--no-same-owner', '-C', directory], { stdio: 'pipe' });
    return inspect(files, path => {
      assert(files.includes(path) && !path.endsWith('/'), `Missing archive member: ${path}`);
      return readFileSync(join(directory, path));
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
