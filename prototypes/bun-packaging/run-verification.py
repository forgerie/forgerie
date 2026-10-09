#!/usr/bin/env nix
#! nix shell nixpkgs#python3 nixpkgs#nodejs_24 --command python3
"""Run the repository's Node verification without the production profile."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

repo = Path(__file__).resolve().parents[2]
root = Path('/tmp/forgerie-bun-spikes/verification')
root.mkdir(parents=True, exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='profile-', dir=root))
env = {key: os.environ[key] for key in ['PATH', 'TMPDIR', 'LANG', 'TZ', 'SHELL'] if key in os.environ}
env.update({'HOME': str(profile), 'XDG_CONFIG_HOME': str(profile / 'config'), 'XDG_DATA_HOME': str(profile / 'data'),
    'PI_CODING_AGENT_DIR': str(profile / 'agent'), 'PI_WEB_AGENT_DIR': str(profile / 'agent'),
    'PI_WEB_DATA_DIR': str(profile / 'web-data'), 'PI_WEB_CONFIG': str(profile / 'web-config.json'),
    'PI_OFFLINE': '1', 'PI_WEB_OFFLINE': '1', 'CLIPROXYAPI_API_KEY': '', 'CLIPROXYAPI_BASE_URL': '',
    'CI': '1', 'NO_COLOR': '1'})
command = [shutil.which('npm'), 'run', 'verify']
started = time.monotonic()
with (root / 'stdout.log').open('w') as stdout, (root / 'stderr.log').open('w') as stderr:
    result = subprocess.run(command, cwd=repo, env=env, stdout=stdout, stderr=stderr, timeout=900)
report = {'command': command, 'exitCode': result.returncode, 'seconds': time.monotonic() - started}
(root / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
shutil.rmtree(profile)
print(json.dumps(report, indent=2))
raise SystemExit(result.returncode)
