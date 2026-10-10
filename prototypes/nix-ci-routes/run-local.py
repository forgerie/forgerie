#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Bounded rootless test; owns only its named container and temporary workspace."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('route', choices=('yeradon', 'arion'))
parser.add_argument('--scratch', default='/tmp/nix-ci-routes')
parser.add_argument('--source', default='/tmp/nix-ci-routes/forgerie-source')
parser.add_argument('--smoke-only', action='store_true')
parser.add_argument('--non-root-payload', action='store_true')
parser.add_argument('--image-archive')
parser.add_argument('--external-runtime', choices=('upstream-runner', 'nixos-runner'))
parser.add_argument('--arion-artifacts', default='/tmp/nix-ci-routes/arion-artifacts')
args = parser.parse_args()
root = Path(args.scratch).resolve()
probe = Path(__file__).resolve().parent
attempt = root / f'{args.route}-{time.time_ns()}'
attempt.mkdir(parents=True)
work = attempt / 'work'
shutil.copytree(args.source, work, ignore=shutil.ignore_patterns('node_modules', '.npm', 'coverage', 'dist'))
name = f'forgerie-ci-{args.route}-{os.getpid()}'
podman = ['podman', '--root', str(root / 'podman-storage'), '--runroot', f'/run/user/{os.getuid()}/forgerie-ci-routes']
report = {'route': args.route, 'attempt': str(attempt), 'commands': [], 'outcome': 'running', 'cleanup': {}}
created = False


def interrupt(signum, _frame):
    report['cancelled'] = True
    raise InterruptedError(f'Interrupted by signal {signum}; cleaning owned resources')


signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGINT, interrupt)


def save():
    (attempt / 'receipt.json').write_text(json.dumps(report, indent=2) + '\n')


def run(command, timeout=120, check=True, stream=False):
    print('CI_ROUTE_COMMAND ' + ' '.join(command), flush=True)
    started = time.monotonic()
    try:
        completed = subprocess.run(command, text=True, capture_output=not stream, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        def decode(value):
            return value.decode(errors='replace') if isinstance(value, bytes) else (value or '')
        completed = subprocess.CompletedProcess(command, 124, decode(error.stdout), decode(error.stderr) + '\nTimed out')
    record = {'command': command, 'exit': completed.returncode, 'seconds': round(time.monotonic() - started, 3)}
    if not stream:
        record.update(stdout=completed.stdout, stderr=completed.stderr)
        print(completed.stdout, end='', flush=True)
        print(completed.stderr, end='', file=sys.stderr, flush=True)
    report['commands'].append(record)
    save()
    if check and completed.returncode != 0:
        raise RuntimeError(f'Command failed with exit {completed.returncode}: {command}')
    return completed


try:
    source_sha = run(['git', '-C', str(work), 'rev-parse', 'HEAD']).stdout.strip()
    if source_sha != '09e3ef5e2ab8cf369a346915a6469a099a6cb616':
        raise RuntimeError(f'Unexpected source revision: {source_sha}')
    report['sourceSha'] = source_sha
    if args.route == 'yeradon':
        archive = Path(args.image_archive) if args.image_archive else root / 'yeradon-image'
        report['upstreamSha'] = '6c839856889e5b99dbd52a09f50cb7c42cc06207'
        report['upstreamImageUnmodified'] = not bool(args.image_archive)
    else:
        artifacts = Path(args.arion_artifacts)
        archive = root / f'{artifacts.name}-image.tar.gz'
        started = time.monotonic()
        with archive.open('wb') as output:
            subprocess.run([str(artifacts)], stdout=output, check=True, timeout=900)
        report['streamSeconds'] = round(time.monotonic() - started, 3)
        report['upstreamSha'] = '9b24cf65c72cb0e9616e437d55e1ac8e5c6bc715'
        report['arionConfiguration'] = json.loads(Path(str(artifacts) + '-1').read_text())
    report['archiveBytes'] = archive.stat().st_size
    loaded = run(podman + ['load', '--input', str(archive)], timeout=900)
    combined = loaded.stdout + loaded.stderr
    image_lines = [line.removeprefix('Loaded image: ').strip() for line in combined.splitlines() if line.startswith('Loaded image: ')]
    if len(image_lines) != 1:
        raise RuntimeError('Could not identify one loaded image')
    image = image_lines[0]
    image_info = json.loads(run(podman + ['image', 'inspect', image]).stdout)[0]
    report['image'] = {'name': image, 'id': image_info['Id'], 'size': image_info['Size'], 'digest': image_info.get('Digest')}
    command = podman + ['create', '--name', name, '--cpus', '4', '--memory', '16g', '--cgroup-conf', 'memory.high=12884901888', '--pids-limit', '2048', '--cgroupns', 'private', '--volume', f'{work}:/work:rw', '--volume', f'{probe}:/probe:ro', '--workdir', '/work']
    if args.external_runtime:
        runtimes = json.loads((root / 'runtimes.json').read_text())
        external = runtimes['externalPath'] if args.external_runtime == 'upstream-runner' else runtimes['nativeExternalPath']
        command += ['--volume', f'{external}:/__e:ro']
    if args.non_root_payload:
        command += ['--userns', 'keep-id:uid=1000,gid=1000', '--user', '0:0']
    if args.route == 'yeradon':
        command += ['--init', '--entrypoint', '/bin/sh', image, '/probe/keepalive.sh']
    else:
        config = report['arionConfiguration']['services']['ci']
        for key, value in config.get('environment', {}).items():
            command += ['--env', f'{key}={value}']
        for volume in config.get('volumes', []):
            command += ['--volume', volume]
        for tmpfs in config.get('tmpfs', []):
            command += ['--tmpfs', tmpfs]
        command += ['--systemd', 'always', '--stop-signal', config['stop_signal'], '--tty', image]
    run(command)
    created = True
    start = time.monotonic()
    run(podman + ['start', name])
    if args.route == 'arion':
        # Bounded readiness probe, not an unbounded agent-side wait loop.
        deadline = time.monotonic() + 60
        ready = False
        while time.monotonic() < deadline:
            state = json.loads(run(podman + ['inspect', name]).stdout)[0]['State']
            if not state['Running']:
                break
            probe_result = run(podman + ['exec', name, '/run/current-system/systemd/bin/systemctl', 'is-active', 'ci-probe.service'], check=False)
            if probe_result.returncode == 0:
                ready = True
                break
            time.sleep(1)
        run(podman + ['logs', name], check=False)
        if not ready:
            raise RuntimeError('NixOS systemd probe did not become active within 60 seconds')
    report['startupSeconds'] = round(time.monotonic() - start, 3)
    state = json.loads(run(podman + ['inspect', name]).stdout)[0]
    pid = state['State']['Pid']
    cgroup_line = Path(f'/proc/{pid}/cgroup').read_text().strip()
    cgroup_path = Path('/sys/fs/cgroup') / cgroup_line.split(':', 2)[2].lstrip('/')
    # systemd puts PID 1 in init.scope. Limits still apply at its ancestor.
    while cgroup_path != Path('/sys/fs/cgroup') and (not (cgroup_path / 'cpu.max').exists() or (cgroup_path / 'cpu.max').read_text().strip().startswith('max ')):
        cgroup_path = cgroup_path.parent
    report['hostCgroupPath'] = str(cgroup_path)
    report['hostCgroup'] = {key: (cgroup_path / key).read_text().strip() for key in ('cpu.max', 'memory.high', 'memory.max', 'pids.max')}
    if report['hostCgroup'] != {'cpu.max': '400000 100000', 'memory.high': '12884901888', 'memory.max': '17179869184', 'pids.max': '2048'}:
        raise RuntimeError(f'Resource bounds differ: {report["hostCgroup"]}')
    payload_exec = ['exec'] + (['--user', '1000:1000'] if args.non_root_payload else [])
    run(podman + payload_exec + [name, 'mkdir', '-p', '/tmp/ci-home', '/tmp/ci-pi'])
    run(podman + ['exec', name, 'node', '--version'])
    run(podman + ['exec', name, 'npm', '--version'])
    run(podman + ['exec', name, 'cat', '/proc/1/comm'])
    report['nonRootPayload'] = args.non_root_payload
    if args.non_root_payload:
        report['preflight'] = json.loads(run(podman + payload_exec + [name, 'node', '/probe/preflight.mjs']).stdout)
    if args.external_runtime:
        runtime_probe = run(podman + payload_exec + [name, '/__e/node24/bin/node', '--version'], check=False)
        report['externalRuntime'] = {'runtime': args.external_runtime, 'exit': runtime_probe.returncode, 'stdout': runtime_probe.stdout, 'stderr': runtime_probe.stderr, 'scope': 'Injected executable only; not a complete JavaScript action'}
    if not args.smoke_only:
        run(podman + payload_exec + ['--env', 'CI_ROUTE_OUTPUT=/work/.ci-route-output', name, 'node', '/probe/payload.mjs'], timeout=3600, stream=True)
        report['payload'] = json.loads((work / '.ci-route-output/payload.json').read_text())
    if args.route == 'arion':
        failed = run(podman + ['exec', name, '/run/current-system/systemd/bin/systemctl', '--failed', '--no-legend', '--no-pager'])
        report['systemdFinal'] = {'failedUnits': failed.stdout.strip()}
        run(podman + ['exec', name, '/run/current-system/systemd/bin/systemctl', 'is-active', 'ci-probe.service'])
        if failed.stdout.strip():
            raise RuntimeError('Guest systemd has failed units after the payload')
    report['outcome'] = 'passed'
except Exception as error:
    report['outcome'] = 'failed'
    report['error'] = str(error)
    if created:
        run(podman + ['logs', name], check=False)
finally:
    if created:
        stop_seconds = '2' if report.get('cancelled') else '15'
        report['cleanup']['stopExit'] = run(podman + ['stop', '--time', stop_seconds, name], check=False, timeout=60).returncode
        report['cleanup']['removeExit'] = run(podman + ['rm', '--force', '--volumes', name], check=False, timeout=60).returncode
    report['cleanup']['containerExists'] = run(podman + ['container', 'exists', name], check=False).returncode == 0
    payload_path = work / '.ci-route-output/payload.json'
    if payload_path.exists():
        report['payload'] = json.loads(payload_path.read_text())
    coverage_path = work / 'coverage'
    try:
        if coverage_path.exists():
            shutil.copytree(coverage_path, attempt / 'coverage')
            report['coverageArtifact'] = str(attempt / 'coverage')
        shutil.rmtree(work)
    except Exception as error:
        report['cleanup']['error'] = str(error)
    report['cleanup']['workspaceExists'] = work.exists()
    if report['cleanup']['containerExists'] or report['cleanup']['workspaceExists'] or report['cleanup'].get('error') or report['cleanup'].get('stopExit', 0) != 0 or report['cleanup'].get('removeExit', 0) != 0:
        report['outcome'] = 'failed'
        report.setdefault('error', 'Owned-resource cleanup did not pass')
    save()
    print('CI_ROUTE_RECEIPT ' + str(attempt / 'receipt.json'), flush=True)
sys.exit(0 if report['outcome'] == 'passed' else 1)
