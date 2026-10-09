import { appendFileSync } from 'node:fs';
import { installHttpAdapter, undici } from './http-adapter.mjs';

if (process.env.SPIKE_EXPECT_BUN && process.versions.bun !== process.env.SPIKE_EXPECT_BUN) {
  throw new Error(`Wrong worker runtime: ${JSON.stringify(process.versions)}`);
}
const configuration = process.versions.bun ? installHttpAdapter('install') : {};
if (process.env.SPIKE_WORKER_EVIDENCE) {
  appendFileSync(process.env.SPIKE_WORKER_EVIDENCE, JSON.stringify({
    pid: process.pid, execPath: process.execPath, node: process.versions.node,
    bun: process.versions.bun ?? null, httpAdapter: process.versions.bun ? 'install' : null,
    fetchIsInstalled: globalThis.fetch === undici.fetch, ...configuration,
  }) + '\n');
}
