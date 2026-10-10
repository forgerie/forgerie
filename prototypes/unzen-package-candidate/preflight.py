#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Disposable namespace preflight. Not an image run or registered runner job."""
import json
from pathlib import Path
import shutil
import subprocess
import time

UNIT = 'github-runner-forgerie.service'
PROPERTIES = [
    'ActiveState', 'MainPID', 'User', 'Group', 'Slice', 'PrivateTmp',
    'PrivateUsers', 'PrivateDevices', 'NoNewPrivileges', 'ProtectSystem',
    'ProtectHome', 'ProtectControlGroups', 'ProtectKernelTunables',
    'ProtectKernelModules', 'ProtectKernelLogs', 'ProtectClock', 'ProtectHostname',
    'CapabilityBoundingSet', 'AmbientCapabilities', 'RestrictNamespaces',
    'RestrictAddressFamilies', 'RestrictRealtime', 'RestrictSUIDSGID',
    'LockPersonality', 'MemoryDenyWriteExecute', 'SystemCallFilter',
    'DevicePolicy', 'DeviceAllow', 'Delegate', 'IPAddressDeny', 'IPAddressAllow',
    'InaccessiblePaths', 'ReadWritePaths', 'ReadOnlyPaths', 'BindPaths',
    'BindReadOnlyPaths',
]


def run(command, timeout=30):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    return {'command': command, 'exit': result.returncode,
            'stdout': result.stdout.strip(), 'stderr': result.stderr.strip()}


def properties(unit, names):
    result = run(['systemctl', 'show', unit, '--property=' + ','.join(names)])
    if result['exit'] != 0:
        raise RuntimeError('Cannot read systemd properties for ' + unit)
    return dict(line.split('=', 1) for line in result['stdout'].splitlines() if '=' in line)


def ready():
    result = run(['/etc/github-actions/ready', '--timeout', '20'])
    if result['exit'] != 0:
        raise RuntimeError('Existing runner readiness check failed: ' + result['stderr'])
    value = json.loads(result['stdout'])
    if not value.get('ready') or value.get('busy') is not False:
        raise RuntimeError('Existing runner must be ready and idle')
    return value


def main():
    record = {
        'scope': 'Transient units on physical UNZEN with selected live Service restrictions copied verbatim',
        'notTested': ['actual registered runner job', 'image loading', 'image payload', 'complete unit equivalence'],
        'candidate': 'Previously tested Yeradon compatibility image',
        'candidateDigest': 'sha256:87a23bef7e8ecdf1170617111aed0cc599393054f88e822ab7f3602ab6e9549d',
        'probes': [], 'cleanup': [], 'imagePayloadStarted': False,
    }
    names = []
    failure = None
    try:
        record['readyBefore'] = ready()
        live = properties(UNIT, PROPERTIES)
        record['liveProperties'] = live
        if live.get('ActiveState') != 'active' or int(live.get('MainPID', '0')) <= 0:
            raise RuntimeError('Existing runner has no active listener')
        if live.get('User') != 'github-runner-forgerie' or live.get('Slice') != 'github-actions.slice':
            raise RuntimeError('Unexpected runner identity or slice')
        record['hostPodman'] = shutil.which('podman')
        unshare = shutil.which('unshare')
        true = shutil.which('true')
        if not unshare or not true:
            raise RuntimeError('Host preflight utilities are absent')
        options = []
        for key, value in live.items():
            if key not in ('ActiveState', 'MainPID'):
                options.append('--property=' + key + '=' + value)
        nonce = str(time.time_ns())
        for kind, arguments in [('user', ['--user', '--map-current-user']), ('mount', ['--mount'])]:
            name = f'forgerie-package-preflight-{nonce}-{kind}.service'
            names.append(name)
            command = ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--unit=' + name,
                       '--property=Type=exec', '--property=RuntimeMaxSec=15s',
                       '--property=TimeoutStartSec=15s', '--property=TimeoutStopSec=5s',
                       *options, '--', unshare, *arguments, true]
            result = run(command, timeout=30)
            result['kind'] = kind
            record['probes'].append(result)
        record['readyAfter'] = ready()
        after = properties(UNIT, ['ActiveState', 'MainPID'])
        record['listenerAfter'] = after
        if after['MainPID'] != live['MainPID'] or record['readyAfter']['runner_id'] != record['readyBefore']['runner_id']:
            raise RuntimeError('Existing runner listener changed during preflight')
        denied = all(p['exit'] != 0 and 'unshare failed: Operation not permitted' in p['stderr'] for p in record['probes'])
        record['outcome'] = 'blocked-by-namespace-preflight' if denied else 'inspect-probe-results'
    except Exception as error:
        failure = str(error)
        record['outcome'] = 'preflight-infrastructure-failure'
        record['error'] = failure
    finally:
        for name in names:
            state = properties(name, ['LoadState', 'ActiveState'])
            if state.get('LoadState') != 'not-found':
                run(['systemctl', 'stop', name], timeout=15)
                run(['systemctl', 'reset-failed', name], timeout=15)
            remaining = properties(name, ['LoadState', 'ActiveState'])
            record['cleanup'].append({'unit': name, 'after': remaining})
        if any(item['after'].get('LoadState') != 'not-found' for item in record['cleanup']):
            record['outcome'] = 'cleanup-failed'
            failure = 'Transient unit remains loaded'
        print(json.dumps(record, indent=2), flush=True)
    return 1 if failure else 0


if __name__ == '__main__':
    raise SystemExit(main())
