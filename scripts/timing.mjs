import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

export function timedSync(label, action) {
  const start = performance.now();
  let status = 'failed';
  try {
    const result = action();
    status = 'passed';
    return result;
  } finally {
    const line = `[timing] ${label}: ${((performance.now() - start) / 1000).toFixed(2)}s (${status})`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
  }
}
