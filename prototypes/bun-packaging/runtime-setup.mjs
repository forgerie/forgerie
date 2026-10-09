import { appendFileSync } from 'node:fs';

// Prove the test workers use the requested runtime rather than a Node fallback.
if (process.env.SPIKE_WORKER_EVIDENCE) {
  appendFileSync(process.env.SPIKE_WORKER_EVIDENCE, JSON.stringify({
    pid: process.pid,
    execPath: process.execPath,
    node: process.versions.node,
    bun: process.versions.bun ?? null,
  }) + '\n');
}
if (process.env.SPIKE_EXPECT_BUN && process.versions.bun !== process.env.SPIKE_EXPECT_BUN) {
  throw new Error(`Wrong worker runtime: ${JSON.stringify(process.versions)}`);
}
