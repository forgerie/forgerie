#!/usr/bin/env nix
#! nix shell nixpkgs#python3 nixpkgs#nodejs_24 --command python3
"""Run a minimal runtime comparison outside the test framework."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parents[2]
root = Path('/tmp/forgerie-bun-spikes')
reports = []
for name, exe in [('node', shutil.which('node')), ('bun', str(root / 'bun-1.4.2'))]:
    profile = Path(tempfile.mkdtemp(prefix='api-profile-', dir=root))
    env = {key: os.environ[key] for key in ['PATH', 'TMPDIR', 'LANG', 'TZ', 'SHELL'] if key in os.environ}
    env.update({'HOME': str(profile), 'PI_CODING_AGENT_DIR': str(profile / 'agent'), 'PI_OFFLINE': '1', 'CLIPROXYAPI_API_KEY': ''})
    result = subprocess.run([exe, 'prototypes/bun-packaging/http-idle-probe.mjs'], cwd=repo, env=env, capture_output=True, text=True, timeout=15)
    report = {'runtime': name, 'exitCode': result.returncode, 'stderr': result.stderr, 'probe': json.loads(result.stdout)}
    label = sys.argv[1] if len(sys.argv) > 1 else 'first'
    (root / f'{name}-api-probe-{label}.json').write_text(json.dumps(report, indent=2) + '\n')
    reports.append(report)
    shutil.rmtree(profile)
print(json.dumps(reports, indent=2))
