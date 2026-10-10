#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// The same payload runs against the same clean checkout in both containers.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const output = process.env.CI_ROUTE_OUTPUT ?? '/work/.ci-route-output';
mkdirSync(output, { recursive: true });
const report = {
  node: process.version,
  architecture: process.arch,
  platform: process.platform,
  cgroup: readFileSync('/proc/self/cgroup', 'utf8'),
  steps: [],
  outcome: 'running',
};
const save = () => writeFileSync(`${output}/payload.json`, `${JSON.stringify(report, null, 2)}\n`);
save();
if (Number(process.versions.node.split('.')[0]) !== 24) {
  report.outcome = 'wrong-node-major';
  save();
  process.exit(1);
}
const stages = [
  ['install', ['ci'], 900],
  ['static', ['run', 'verify:static'], 900],
  ['coverage', ['run', 'test:coverage', '--', '--no-file-parallelism'], 1200],
  ['browser', ['run', 'verify:ui'], 900],
  ['build', ['run', 'build'], 900],
  ['package-smoke', ['run', 'smoke:package-install'], 900],
  ['package-contents', ['run', 'pack:dry'], 900],
];
for (const [name, args, timeout] of stages) {
  const start = performance.now();
  console.log(`CI_ROUTE_STAGE_BEGIN ${name}`);
  const completed = spawnSync('npm', args, {
    stdio: 'inherit',
    timeout: timeout * 1000,
    killSignal: 'SIGTERM',
    env: {
      ...process.env,
      CI: 'true',
      HOME: '/tmp/ci-home',
      PI_CODING_AGENT_DIR: '/tmp/ci-pi',
      npm_config_cache: '/work/.npm',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
  const step = {
    name,
    command: ['npm', ...args],
    exit: completed.status,
    signal: completed.signal,
    error: completed.error?.message ?? null,
    seconds: Number(((performance.now() - start) / 1000).toFixed(3)),
  };
  report.steps.push(step);
  save();
  console.log(`CI_ROUTE_STAGE_END ${name} exit=${completed.status}`);
  if (completed.status !== 0 || completed.error) {
    report.outcome = 'failed';
    save();
    process.exit(1);
  }
}
report.outcome = 'passed';
save();
console.log('CI_ROUTE_PAYLOAD_PASSED');
