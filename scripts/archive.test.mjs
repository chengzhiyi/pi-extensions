import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withPackedFiles } from './archive.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'archive-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Python's tarfile lets us construct malicious member names without the tar CLI
// normalizing them away. No fixture archive is extracted by the test itself.
function archive(dir, members) {
  const path = join(dir, 'fixture.tgz');
  execFileSync('python3', ['-c', `import tarfile,io,json,sys
with tarfile.open(sys.argv[1], 'w:gz') as archive:
 for m in json.loads(sys.argv[2]):
  entry=tarfile.TarInfo(m['name'])
  content=m.get('content','').encode()
  if m.get('link'):
   entry.type=tarfile.SYMTYPE
   entry.linkname=m['link']
  elif m.get('hardlink'):
   entry.type=tarfile.LNKTYPE
   entry.linkname=m['hardlink']
  elif m.get('fifo'):
   entry.type=tarfile.FIFOTYPE
  else:
   entry.size=len(content)
  archive.addfile(entry,io.BytesIO(content))
`, path, JSON.stringify(members)]);
  return path;
}

test('reads exact bytes for all resources and propagates callback failure', t => {
  const dir = fixture(t);
  const path = archive(dir, [{ name: 'package/package.json', content: '{}' }, { name: 'package/dist/asset.js', content: 'hello' }]);
  withPackedFiles(path, (files, read) => {
    assert.equal(files.length, 2);
    assert.equal(read('package/dist/asset.js').toString(), 'hello');
    assert.throws(() => read('../outside'), /Missing/);
  });
  assert.throws(() => withPackedFiles(path, () => { throw new Error('callback failed'); }), /callback failed/);
});

test('rejects traversal, absolute paths, duplicates, links and special files before inspection', t => {
  const dir = fixture(t);
  for (const members of [
    [{ name: '../escape' }], [{ name: '/tmp/escape' }],
    [{ name: 'package/../escape' }], [{ name: 'package/./asset' }],
    [{ name: 'package/a' }, { name: 'package/a' }],
    [{ name: 'package/a', link: '/tmp' }],
    [{ name: 'package/a', hardlink: '/tmp/outside' }],
    [{ name: 'package/a', fifo: true }],
  ]) {
    assert.throws(() => withPackedFiles(archive(dir, members), () => assert.fail('unsafe archive reached inspection')),
      /Unsafe|Duplicate|Links/);
  }
});
