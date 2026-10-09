#!/usr/bin/env nix
#! nix shell nixpkgs#python3 nixpkgs#nodejs_24 nixpkgs#openssl --command python3
"""Bounded, isolated HTTP-adapter experiment; never patches production source."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['matrix', 'errors', 'compat', 'smoke', 'verify', 'save'])
parser.add_argument('--label', default='http-adapter')
parser.add_argument('--runtime', choices=['node', 'bun'], default='bun')
parser.add_argument('--mode', choices=['native', 'dispatcher', 'fetch', 'install'])
parser.add_argument('--sdk-offline', action='store_true', help='Reproduce the early test-runner offline-mode error.')
parser.add_argument('tests', nargs='*')
args = parser.parse_intermixed_args()
repo = Path(__file__).resolve().parents[2]
if not (repo / '.git').is_file():
    parser.error('Run in a linked isolated git worktree, not the deployed checkout.')
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', args.label):
    parser.error('Label must be a single safe directory name.')
root = Path('/tmp/forgerie-bun-spikes') / args.label
root.mkdir(parents=True, exist_ok=True)
node = shutil.which('node')
bun = '/tmp/forgerie-bun-spikes/bun-1.4.2'


def isolated_env(profile):
    env = {key: os.environ[key] for key in ['PATH', 'TMPDIR', 'LANG', 'TZ', 'SHELL'] if key in os.environ}
    env.update({'HOME': str(profile), 'XDG_CONFIG_HOME': str(profile / 'config'), 'XDG_DATA_HOME': str(profile / 'data'),
        'PI_CODING_AGENT_DIR': str(profile / 'agent'), 'PI_WEB_AGENT_DIR': str(profile / 'agent'),
        'PI_WEB_CONFIG': str(profile / 'web-config.json'), 'PI_WEB_DATA_DIR': str(profile / 'web-data'),
        'PI_OFFLINE': '1', 'PI_WEB_OFFLINE': '1', 'CLIPROXYAPI_API_KEY': '', 'CLIPROXYAPI_BASE_URL': '',
        'CI': '1', 'NO_COLOR': '1', 'npm_execpath': os.path.realpath(shutil.which('npm'))})
    return env


def test_env(profile):
    env = isolated_env(profile)
    # Normal SDK resolver callbacks are test behavior. A forced PI_OFFLINE skips
    # them even when the callback says not to install a missing package.
    if not args.sdk_offline:
        env.pop('PI_OFFLINE')
    return env


def patch_private_build():
    original = repo / 'dist/server/sessiond/agentHttpDispatcher.js'
    source = original.read_text()
    assert source.count('from "undici"') == 1, 'Private patch no longer matches; rebuild/review before retry'
    patched = source.replace('from "undici"', f'from "{(repo / "node_modules/undici/index.js").as_uri()}"')
    (original.parent / 'agentHttpDispatcher.spike.js').write_text(patched)
    return {'originalSha256': hashlib.sha256(source.encode()).hexdigest(),
        'patchedSha256': hashlib.sha256(patched.encode()).hexdigest(),
        'edit': 'Only the import specifier changes in an additional private compiled module.'}


if args.action == 'matrix':
    build = patch_private_build()
    certificate = root / 'tls-fixture'
    certificate.mkdir(exist_ok=True)
    key = certificate / 'key.pem'
    cert = certificate / 'cert.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key), '-out', str(cert),
        '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
        check=True, capture_output=True)
    combinations = [(args.runtime, args.mode)] if args.mode else [('node', 'native'), ('bun', 'native'),
        ('bun', 'dispatcher'), ('bun', 'fetch'), ('bun', 'install')]
    results = []
    for runtime, mode in combinations:
        profile = Path(tempfile.mkdtemp(prefix='profile-', dir=root))
        env = isolated_env(profile)
        env.update({'SPIKE_TLS_KEY': str(key), 'SPIKE_TLS_CERT': str(cert), 'NODE_EXTRA_CA_CERTS': str(cert)})
        command = [node if runtime == 'node' else bun, str(repo / 'prototypes/bun-packaging/http-adapter-probe.mjs'), mode]
        try:
            try:
                result = subprocess.run(command, cwd=repo, env=env, text=True, capture_output=True, timeout=75)
            except subprocess.TimeoutExpired as error:
                stdout = error.stdout.decode() if isinstance(error.stdout, bytes) else error.stdout or ''
                stderr = error.stderr.decode() if isinstance(error.stderr, bytes) else error.stderr or ''
                result = subprocess.CompletedProcess(command, 124, stdout, stderr)
            (root / f'{runtime}-{mode}.stdout.log').write_text(result.stdout)
            (root / f'{runtime}-{mode}.stderr.log').write_text(result.stderr)
            report = {'command': command, 'exitCode': result.returncode, 'stderr': result.stderr,
                'probe': json.loads(result.stdout) if result.stdout else None}
            (root / f'{runtime}-{mode}.json').write_text(json.dumps(report, indent=2) + '\n')
            results.append(report)
            print(json.dumps({'runtime': runtime, 'mode': mode, 'exitCode': result.returncode,
                'passed': report['probe']['passed'] if report['probe'] else None,
                'failed': [item['name'] for item in report['probe']['checks'] if not item['passed']] if report['probe'] else result.stderr}), flush=True)
        finally:
            shutil.rmtree(profile)
    metadata = {'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
        'lockSha256': hashlib.sha256((repo / 'package-lock.json').read_bytes()).hexdigest(), 'privateBuildPatch': build,
        'bunBinarySha256': hashlib.sha256(Path(bun).read_bytes()).hexdigest(),
        'packageVersions': {name: json.loads((repo / 'node_modules' / name / 'package.json').read_text())['version']
            for name in ['undici', 'vitest', 'zod', '@earendil-works/pi-coding-agent']},
        'node': subprocess.check_output([node, '--version'], text=True).strip(),
        'bun': subprocess.check_output([bun, '--version'], text=True).strip(),
        'qualification': 'Loopback HTTP/TLS only. Synthetic CA/proxy credentials. No live providers. Shared-host durations are not benchmarks.'}
    (root / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    expected = results if args.mode else [row for row in results
        if row['probe'] and ((not row['probe']['runtime']['bun'] and row['probe']['mode'] == 'native') or row['probe']['mode'] == 'install')]
    raise SystemExit(0 if expected and all(row['exitCode'] == 0 for row in expected) else 1)

if args.action == 'errors':
    reports = []
    for runtime, exe in [('node', node), ('bun', bun)]:
        profile = Path(tempfile.mkdtemp(prefix='errors-', dir=root))
        command = [exe, 'prototypes/bun-packaging/http-error-probe.mjs']
        try:
            result = subprocess.run(command, cwd=repo, env=isolated_env(profile), capture_output=True, text=True, timeout=20)
            report = {'command': command, 'exitCode': result.returncode, 'stderr': result.stderr,
                'probe': json.loads(result.stdout) if result.stdout else None}
            (root / f'{runtime}-errors.json').write_text(json.dumps(report, indent=2) + '\n')
            reports.append(report)
            print(json.dumps(report, indent=2), flush=True)
        finally:
            shutil.rmtree(profile)
    # Bun is an expected negative control, but a failed Node control blocks the experiment.
    raise SystemExit(0 if reports[0]['exitCode'] == 0 else 1)

if args.action == 'compat':
    runtime = args.runtime
    output = root / f'{runtime}-compat'
    output.mkdir(exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=output))
    env = test_env(profile)
    env['SPIKE_WORKER_EVIDENCE'] = str(output / 'workers.jsonl')
    if runtime == 'bun':
        env['SPIKE_EXPECT_BUN'] = '1.4.2'
    command = [node if runtime == 'node' else bun] + ([] if runtime == 'node' else ['--bun']) + [
        'node_modules/vitest/vitest.mjs', 'run', '--config', 'prototypes/bun-packaging/vitest.http-adapter.config.mjs',
        '--reporter=default', '--reporter=json', f'--outputFile={output / "vitest.json"}'] + args.tests
    try:
        with (output / 'stdout.log').open('w') as stdout, (output / 'stderr.log').open('w') as stderr:
            result = subprocess.run(command, cwd=repo, env=env, stdout=stdout, stderr=stderr, timeout=600)
        report = {'runtime': runtime, 'command': command, 'exitCode': result.returncode,
            'sdkOfflineForced': args.sdk_offline,
            'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()}
        if (output / 'vitest.json').exists():
            vitest = json.loads((output / 'vitest.json').read_text())
            report['tests'] = {key: vitest.get(key) for key in ['numTotalTests', 'numPassedTests', 'numFailedTests',
                'numPendingTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'success']}
            report['files'] = [{'file': str(Path(item['name']).relative_to(repo)), 'status': item['status'],
                'message': item.get('message', ''), 'failed': [{'name': test['fullName'], 'messages': test['failureMessages']}
                    for test in item['assertionResults'] if test['status'] == 'failed']} for item in vitest['testResults']]
        if (output / 'workers.jsonl').exists():
            workers = [json.loads(line) for line in (output / 'workers.jsonl').read_text().splitlines()]
            report['workerRuntimes'] = sorted({f"node={row['node']} bun={row['bun']}" for row in workers})
            report['adapterWorkers'] = sum(row.get('httpAdapter') == 'install' for row in workers)
        (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({key: value for key, value in report.items() if key != 'files'}, indent=2), flush=True)
        raise SystemExit(result.returncode)
    finally:
        shutil.rmtree(profile)

if args.action == 'smoke':
    # A private build changes only this daemon's dispatcher import and install call.
    original = repo / 'dist/server/sessiond/agentHttpDispatcher.js'
    source = original.read_text()
    assert source.count('from "undici"') == 1
    assert source.count('export function configureAgentHttpDispatcher(timeoutMs) {') == 1
    patched = source.replace('from "undici"', f'from "{(repo / "node_modules/undici/index.js").as_uri()}"')
    patched = 'import { install } from "' + (repo / 'node_modules/undici/index.js').as_uri() + '";\n' + patched
    patched = patched.replace('export function configureAgentHttpDispatcher(timeoutMs) {',
        'export function configureAgentHttpDispatcher(timeoutMs) {\n    install();')
    try:
        original.write_text(patched)
        profile = Path(tempfile.mkdtemp(prefix='smoke-launcher-', dir=root))
        try:
            result = subprocess.run([node, 'prototypes/bun-packaging/daemon-smoke.mjs', 'bun', args.label + '-daemon'],
                cwd=repo, env=isolated_env(profile), timeout=180)
            raise SystemExit(result.returncode)
        finally:
            shutil.rmtree(profile)
    finally:
        original.write_text(source)

if args.action == 'verify':
    output = root / 'node-verification'
    output.mkdir(exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=output))
    command = [shutil.which('npm'), 'run', 'verify']
    try:
        with (output / 'stdout.log').open('w') as stdout, (output / 'stderr.log').open('w') as stderr:
            result = subprocess.run(command, cwd=repo, env=test_env(profile), stdout=stdout, stderr=stderr, timeout=900)
        report = {'command': command, 'exitCode': result.returncode,
            'sdkOfflineForced': args.sdk_offline,
            'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
            'node': subprocess.check_output([node, '--version'], text=True).strip()}
        (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2), flush=True)
        raise SystemExit(result.returncode)
    finally:
        shutil.rmtree(profile)

if args.action == 'save':
    destination = repo / 'prototypes/bun-packaging/evidence' / args.label
    destination.mkdir(parents=True, exist_ok=True)
    for file in root.glob('*.json'):
        shutil.copyfile(file, destination / file.name)
    for file in root.glob('*.log'):
        (destination / (file.name + '.gz')).write_bytes(gzip.compress(file.read_bytes(), mtime=0))
    for output in root.glob('*-compat'):
        target = destination / output.name
        target.mkdir(exist_ok=True)
        shutil.copyfile(output / 'result.json', target / 'result.json')
        for filename in ['stdout.log', 'stderr.log', 'workers.jsonl', 'vitest.json']:
            file = output / filename
            if file.exists():
                (target / (filename + '.gz')).write_bytes(gzip.compress(file.read_bytes(), mtime=0))
    verification = root / 'node-verification'
    if (verification / 'result.json').exists():
        target = destination / 'node-verification'
        target.mkdir(exist_ok=True)
        shutil.copyfile(verification / 'result.json', target / 'result.json')
        for filename in ['stdout.log', 'stderr.log']:
            (target / (filename + '.gz')).write_bytes(gzip.compress((verification / filename).read_bytes(), mtime=0))
    smoke = root.parent / (args.label + '-daemon') / 'result.json'
    if smoke.exists():
        shutil.copyfile(smoke, destination / 'daemon.json')
    summary = {'matrix': []}
    for runtime, mode in [('node', 'native'), ('bun', 'native'), ('bun', 'dispatcher'), ('bun', 'fetch'), ('bun', 'install')]:
        file = destination / f'{runtime}-{mode}.json'
        if file.exists():
            result = json.loads(file.read_text())
            probe = result['probe']
            summary['matrix'].append({'runtime': runtime, 'mode': mode, 'exitCode': result['exitCode'],
                'passed': probe['passed'] if probe else None, 'failed': probe['failed'] if probe else None,
                'failures': [item['name'] for item in probe['checks'] if not item['passed']] if probe else []})
    for runtime in ['node', 'bun']:
        file = destination / f'{runtime}-compat/result.json'
        if file.exists():
            result = json.loads(file.read_text())
            files = result['files']
            summary[runtime + 'Compatibility'] = {'tests': result['tests'], 'filesTotal': len(files),
                'filesPassed': sum(file['status'] == 'passed' for file in files),
                'filesFailed': sum(file['status'] == 'failed' for file in files),
                'importFailures': sum(file['status'] == 'failed' and not file['failed'] for file in files),
                'assertionFailures': [test for file in files for test in file['failed']],
                'workerRuntimes': result.get('workerRuntimes'), 'adapterWorkers': result.get('adapterWorkers')}
    (destination / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))
    print(destination)
