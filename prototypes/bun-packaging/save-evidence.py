#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Preserve bounded reports and compressed raw test logs, never profile state."""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

repo = Path(__file__).resolve().parents[2]
source = Path('/tmp/forgerie-bun-spikes')
destination = Path(__file__).resolve().parent / 'evidence'
destination.mkdir(exist_ok=True)
metadata = {'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
    'lockSha256': hashlib.sha256((repo / 'package-lock.json').read_bytes()).hexdigest(),
    'hostKernel': subprocess.check_output(['uname', '-srmo'], text=True).strip(),
    'note': 'Compatibility evidence only. Test and smoke timings ran under shared-host load and are not benchmark results.'}
(destination / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
shutil.copyfile(source / 'runtime.json', destination / 'runtime.json')
for runtime in ['node', 'bun']:
    labels = ['full-corrected', 'daemon'] + (['zod-only'] if runtime == 'bun' else [])
    for label in labels:
        run = source / f'{runtime}-{label}'
        target = destination / f'{runtime}-{label}'
        target.mkdir(exist_ok=True)
        shutil.copyfile(run / 'result.json', target / 'result.json')
        if (run / 'vitest.json').exists():
            report = json.loads((run / 'vitest.json').read_text())
            files = []
            for item in report['testResults']:
                assertions = item.get('assertionResults', [])
                files.append({'file': str(Path(item['name']).relative_to(repo)), 'status': item['status'], 'message': item.get('message', ''),
                    'passed': sum(row['status'] == 'passed' for row in assertions),
                    'failed': [{'name': row['fullName'], 'failureMessages': row['failureMessages']} for row in assertions if row['status'] == 'failed'],
                    'skipped': sum(row['status'] in ['pending', 'skipped'] for row in assertions)})
            (target / 'files.json').write_text(json.dumps(files, indent=2) + '\n')
            for name in ['stdout.log', 'stderr.log', 'vitest.json', 'workers.jsonl']:
                payload = (run / name).read_bytes()
                # Fixed gzip timestamp avoids irrelevant differences on rerun.
                (target / f'{name}.gz').write_bytes(gzip.compress(payload, mtime=0))
    for path in source.glob(f'{runtime}-api-probe*.json'):
        shutil.copyfile(path, destination / path.name)
verification = source / 'verification' / 'result.json'
if verification.exists():
    shutil.copyfile(verification, destination / 'verification.json')
print(destination)
