import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkNativeEnvironment(report) {
  if (report.platform !== 'linux') throw new Error('The native pilot requires Linux.');
  if (!report.nodeVersion.startsWith('v24.')) throw new Error('The native pilot requires Node 24.');
  if (!report.nodePath.startsWith('/nix/store/')) throw new Error('Node must come from the Nix store.');
  if (!report.tempFilesystem || ['tmpfs', 'ramfs'].includes(report.tempFilesystem)) {
    throw new Error('Temporary files must use a disk-backed filesystem.');
  }
  if (report.hostDaemonAccessible) throw new Error('CI must not use the unbounded host Nix daemon.');
}

function main() {
  const temporaryDirectory = tmpdir();
  const mount = spawnSync('findmnt', ['--noheadings', '--output', 'FSTYPE', '--target', temporaryDirectory], {
    encoding: 'utf8', timeout: 10_000,
  });
  if (mount.error) throw mount.error;
  if (mount.status !== 0) throw new Error(`Cannot inspect temporary storage: ${mount.stderr.trim()}`);
  const daemon = spawnSync('nix', ['--extra-experimental-features', 'nix-command', 'store', 'ping', '--store', 'daemon'], {
    encoding: 'utf8', timeout: 10_000,
  });
  if (daemon.error) throw daemon.error;
  const report = {
    hostname: hostname(),
    platform: process.platform,
    nodeVersion: process.version,
    nodePath: realpathSync(process.execPath),
    temporaryDirectory,
    tempFilesystem: mount.stdout.trim(),
    hostDaemonAccessible: daemon.status === 0,
    checkedAt: new Date().toISOString(),
  };
  writeFileSync('native-ci-report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  checkNativeEnvironment(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
