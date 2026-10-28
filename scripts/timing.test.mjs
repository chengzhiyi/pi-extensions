import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timedSync } from './timing.mjs';

test('timings preserve return values and original failures and append both outcomes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'timing-test-'));
  const previous = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = join(directory, 'summary.md');
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(timedSync('fixture-success', () => 42), 42);
  const failure = new Error('fixture failure');
  assert.throws(() => timedSync('fixture-failure', () => { throw failure; }), error => error === failure);
  const summary = readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.match(summary, /fixture-success: [\d.]+s \(passed\)/);
  assert.match(summary, /fixture-failure: [\d.]+s \(failed\)/);
});
