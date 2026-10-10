#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Exercise actual upstream and NixOS runner Node executables inside each image."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('route', choices=('yeradon', 'arion'))
args = parser.parse_args()
root = Path('/tmp/nix-ci-routes')
podman = ['podman', '--root', str(root / 'podman-storage'), '--runroot', f'/run/user/{os.getuid()}/forgerie-ci-routes']
image = 'nixos-ci-image:26.05' if args.route == 'yeradon' else json.loads((root / 'arion-artifacts-1').read_text())['services']['ci']['image']
runtimes = json.loads((root / 'runtimes.json').read_text())
report = {'route': args.route, 'image': image, 'scope': 'Node execution probe, not a complete JavaScript action or registered runner job', 'probes': []}
for label, path in [('upstream-runner', runtimes['externalPath']), ('nixos-runner', runtimes['nativeExternalPath'])]:
    started = time.monotonic()
    name = f'forgerie-runtime-{args.route}-{label}-{os.getpid()}'
    command = podman + ['run', '--name', name, '--rm', '--network', 'none', '--cpus', '1', '--memory', '512m', '--pids-limit', '64', '--volume', f'{path}:/__e:ro', '--entrypoint', '/__e/node24/bin/node', image, '--version']
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)
        report['probes'].append({'runtime': label, 'command': command, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'seconds': round(time.monotonic() - started, 3)})
    finally:
        cleanup = subprocess.run(podman + ['rm', '--force', name], capture_output=True, text=True, timeout=30)
        exists = subprocess.run(podman + ['container', 'exists', name], capture_output=True, text=True, timeout=30)
        report.setdefault('cleanup', []).append({'name': name, 'removeExit': cleanup.returncode, 'containerExists': exists.returncode == 0})
output = root / f'{args.route}-action-runtimes.json'
output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
# Expected incompatibilities are findings; cleanup is mandatory.
if any(item['containerExists'] for item in report['cleanup']):
    raise RuntimeError('A runtime-probe container survived cleanup')
