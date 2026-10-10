#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'ci-permissions-'));
let writeError = null;
try {
  chmodSync(directory, 0o500);
  try {
    writeFileSync(join(directory, 'denied'), 'must not write');
  } catch (error) {
    writeError = error.code;
  }
} finally {
  chmodSync(directory, 0o700);
  rmSync(directory, { recursive: true });
}
const flock = spawnSync('flock', ['--version'], { encoding: 'utf8' });
const result = {
  uid: process.getuid(),
  gid: process.getgid(),
  permissionDenied: writeError === 'EACCES',
  writeError,
  flock: { exit: flock.status, error: flock.error?.code ?? null, stdout: flock.stdout, stderr: flock.stderr },
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.permissionDenied && flock.status === 0 ? 0 : 1);
