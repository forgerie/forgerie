#!/usr/bin/env nix
#! nix shell nixpkgs#python3 nixpkgs#nodejs_24 --command python3
"""Run unchanged Vitest tests in fresh profiles and capture runtime evidence."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--runtime', choices=['node', 'bun'], required=True)
parser.add_argument('--label', required=True)
parser.add_argument('tests', nargs='*')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
root = Path('/tmp/forgerie-bun-spikes')
root.mkdir(exist_ok=True)
output = root / args.label
output.mkdir(exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='isolated-', dir=output))
# No provider credentials or production profile/config can enter the experiment.
env = {key: os.environ[key] for key in ['PATH', 'TMPDIR', 'TZ', 'LANG', 'LC_ALL', 'SHELL'] if key in os.environ}
env.update({'HOME': str(profile), 'XDG_CONFIG_HOME': str(profile / 'config'), 'XDG_DATA_HOME': str(profile / 'data'),
    'PI_CODING_AGENT_DIR': str(profile / 'agent'), 'PI_WEB_AGENT_DIR': str(profile / 'agent'),
    'PI_WEB_DATA_DIR': str(profile / 'web-data'), 'PI_WEB_CONFIG': str(profile / 'web-config.json'),
    'PI_OFFLINE': '1', 'PI_WEB_OFFLINE': '1', 'CLIPROXYAPI_API_KEY': '', 'CLIPROXYAPI_BASE_URL': '',
    'CI': '1', 'NO_COLOR': '1', 'SPIKE_WORKER_EVIDENCE': str(output / 'workers.jsonl'),
    'npm_execpath': os.path.realpath(shutil.which('npm'))})
exe = shutil.which('node') if args.runtime == 'node' else str(root / 'bun-1.4.2')
command = [exe]
if args.runtime == 'bun':
    command += ['--bun']
    env['SPIKE_EXPECT_BUN'] = '1.4.2'
command += ['node_modules/vitest/vitest.mjs', 'run', '--config', 'prototypes/bun-packaging/vitest.spike.config.mjs', '--reporter=default', '--reporter=json', f'--outputFile={output / "vitest.json"}'] + args.tests
started = time.monotonic()
with (output / 'stdout.log').open('w') as stdout, (output / 'stderr.log').open('w') as stderr:
    try:
        result = subprocess.run(command, cwd=repo, env=env, stdout=stdout, stderr=stderr, timeout=600)
        code = result.returncode
    except subprocess.TimeoutExpired:
        code = 124
report = {'runtime': args.runtime, 'command': command, 'cwd': str(repo), 'exitCode': code, 'seconds': time.monotonic() - started,
    'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(), 'profile': str(profile)}
if (output / 'vitest.json').exists():
    vitest = json.loads((output / 'vitest.json').read_text())
    report['tests'] = {key: vitest.get(key) for key in ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'success']}
if (output / 'workers.jsonl').exists():
    workers = [json.loads(line) for line in (output / 'workers.jsonl').read_text().splitlines()]
    report['workerRuntimes'] = sorted({f"node={row['node']} bun={row['bun']}" for row in workers})
    report['workerFiles'] = len(workers)
(output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
shutil.rmtree(profile)
print(json.dumps(report, indent=2), flush=True)
raise SystemExit(code)
