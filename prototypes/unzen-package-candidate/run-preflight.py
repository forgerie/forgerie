#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Copy the bounded preflight to UNZEN, execute it, and retain its receipt."""
import json
from pathlib import Path
import subprocess
import time

HERE = Path(__file__).resolve().parent
HOST = 'root@100.120.204.5'
OPTIONS = ['-F', '/dev/null', '-i', '/home/simonwjackson/.ssh/id_rsa',
           '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
           '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlias=unzen-first-boot',
           '-o', 'UserKnownHostsFile=/tmp/unzen-first-boot-known_hosts',
           '-o', 'ConnectTimeout=10']
prefix = '/tmp/forgerie-package-candidate-' + str(time.time_ns())
for local, extension in [('preflight.py', '.py'), ('launch-preflight.sh', '.sh')]:
    subprocess.run(['scp', *OPTIONS, str(HERE / local), HOST + ':' + prefix + extension], check=True, timeout=30)
result = subprocess.run(['ssh', *OPTIONS, HOST, '/run/current-system/sw/bin/bash', prefix + '.sh'],
                        capture_output=True, text=True, timeout=120)
output = HERE / 'evidence'
output.mkdir(exist_ok=True)
(output / 'preflight-stdout.log').write_text(result.stdout)
(output / 'preflight-stderr.log').write_text(result.stderr)
if not result.stdout.strip():
    raise RuntimeError('No remote receipt; inspect preflight-stderr.log')
record = json.loads(result.stdout)
record['remoteExit'] = result.returncode
(output / 'unzen-preflight.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({key: record.get(key) for key in ['outcome', 'imagePayloadStarted', 'hostPodman', 'remoteExit']}, indent=2))
if result.returncode != 0:
    raise SystemExit(result.returncode)
