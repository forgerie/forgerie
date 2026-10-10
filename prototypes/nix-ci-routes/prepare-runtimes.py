#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Extract upstream Node selected by runner 2.337.0, with its published checksum."""
import hashlib
import json
from pathlib import Path
import re
import tarfile
import urllib.request

root = Path('/tmp/nix-ci-routes')
source = root / 'upstream-runner-archive'
manifest = (source / 'src/Misc/externals.sh').read_text()
match = re.search(r'^NODE24_VERSION="([0-9.]+)"', manifest, re.MULTILINE)
if not match:
    raise RuntimeError('Runner source does not declare NODE24_VERSION')
version = match.group(1)
filename = f'node-v{version}-linux-x64.tar.gz'
base = f'https://nodejs.org/dist/v{version}'
with urllib.request.urlopen(f'{base}/SHASUMS256.txt', timeout=30) as response:
    sums = response.read().decode()
expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == filename)
archive = root / filename
with urllib.request.urlopen(f'{base}/{filename}', timeout=60) as response, archive.open('wb') as output:
    while chunk := response.read(1024 * 1024):
        output.write(chunk)
actual = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
if actual != expected:
    raise RuntimeError(f'Checksum mismatch for {filename}')
external = root / 'upstream-externals/node24'
external.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive) as bundle:
    for member in bundle.getmembers():
        prefix = f'node-v{version}-linux-x64/'
        if member.name.startswith(prefix):
            member.name = member.name.removeprefix(prefix)
            if member.name:
                bundle.extract(member, path=external, filter='data')
receipt = {'runner': '2.337.0', 'upstreamNode': version, 'url': f'{base}/{filename}', 'sha256': actual, 'externalPath': str(external.parent), 'nativeExternalPath': str((root / 'native-runner/lib/externals').resolve())}
(root / 'runtimes.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
