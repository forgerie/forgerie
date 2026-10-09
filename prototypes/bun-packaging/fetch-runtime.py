#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Fetch the exact release binary into a private experiment directory, never the live profile."""
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import zipfile

ROOT = Path('/tmp/forgerie-bun-spikes')
URL = 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64-baseline.zip'
SHA256 = 'c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f'
ROOT.mkdir(parents=True, exist_ok=True)
archive = ROOT / 'bun-1.4.2.zip'
if not archive.exists():
    with urllib.request.urlopen(URL, timeout=120) as response:
        archive.write_bytes(response.read())
actual = hashlib.sha256(archive.read_bytes()).hexdigest()
if actual != SHA256:
    raise RuntimeError(f'Release archive hash mismatch: {actual}')
with zipfile.ZipFile(archive) as bundle:
    payload = bundle.read('bun-linux-x64-baseline/bun')
binary = ROOT / 'bun-1.4.2'
binary.write_bytes(payload)
binary.chmod(0o755)
# Linux needs the Nix-patched loader. Work only on this private copy.
loader = subprocess.check_output(['nix', 'eval', '--raw', 'nixpkgs#stdenv.cc.bintools.dynamicLinker'], text=True).strip()
subprocess.run(['patchelf', '--set-interpreter', loader, str(binary)], check=True)
version = subprocess.check_output([str(binary), '--version'], text=True).strip()
metadata = {'url': URL, 'archiveSha256': actual, 'binarySha256AfterPatch': hashlib.sha256(binary.read_bytes()).hexdigest(), 'version': version, 'dynamicLinker': loader}
(ROOT / 'runtime.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata, indent=2))
if version != '1.4.2':
    raise RuntimeError(f'Wrong executable version: {version}')
