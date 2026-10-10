#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Run only on a disposable GitHub-hosted Linux VM, never on a production host."""
import argparse
import getpass
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('route', choices=('yeradon', 'arion'))
args = parser.parse_args()
if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
    raise RuntimeError('This setup is restricted to disposable GitHub-hosted runners')
probe = Path(__file__).resolve().parent
root = Path('/tmp/nix-ci-routes')
root.mkdir(parents=True, exist_ok=True)
receipt = {'route': args.route, 'placement': 'GitHub-hosted Linux', 'commands': [], 'diskBefore': shutil.disk_usage('/')._asdict()}


def run(command, cwd=None):
    start = time.monotonic()
    print('CI_HOSTED_COMMAND ' + ' '.join(command), flush=True)
    completed = subprocess.run(command, cwd=cwd)
    receipt['commands'].append({'command': command, 'exit': completed.returncode, 'seconds': round(time.monotonic() - start, 3)})
    (root / 'hosted.json').write_text(json.dumps(receipt, indent=2) + '\n')
    if completed.returncode != 0:
        raise RuntimeError(f'Exit {completed.returncode}: {command}')


try:
    if not shutil.which('podman'):
        run(['sudo', 'apt-get', 'update'])
        run(['sudo', 'apt-get', 'install', '-y', 'podman', 'uidmap'])
    # Resource limits require the ephemeral runner user's systemd manager.
    run(['sudo', 'loginctl', 'enable-linger', getpass.getuser()])
    run(['sudo', 'systemctl', 'start', f'user@{os.getuid()}.service'])
    os.environ['XDG_RUNTIME_DIR'] = f'/run/user/{os.getuid()}'
    os.environ['DBUS_SESSION_BUS_ADDRESS'] = f'unix:path={os.environ["XDG_RUNTIME_DIR"]}/bus'
    source = root / 'forgerie-source'
    source.mkdir()
    run(['git', 'init', str(source)])
    run(['git', 'remote', 'add', 'origin', 'https://github.com/forgerie/forgerie'], cwd=source)
    run(['git', 'fetch', '--depth', '1', 'origin', '09e3ef5e2ab8cf369a346915a6469a099a6cb616'], cwd=source)
    run(['git', 'checkout', '--detach', 'FETCH_HEAD'], cwd=source)
    flake = f'path:{probe}'
    output = root / ('yeradon-compatible-image' if args.route == 'yeradon' else 'arion-compatible-artifacts')
    attributes = [f'{flake}#yeradonCompatible'] if args.route == 'yeradon' else [f'{flake}#arionCompatibleImage', f'{flake}#arionCompatibleCompose']
    run(['nix', 'build', *attributes, '--out-link', str(output), '--max-jobs', '1', '--cores', '2', '--no-write-lock-file'])
    command = ['python3', str(probe / 'run-local.py'), args.route, '--non-root-payload']
    command += ['--image-archive', str(output)] if args.route == 'yeradon' else ['--arion-artifacts', str(output)]
    run(command)
    receipt['outcome'] = 'passed'
except Exception as error:
    receipt['outcome'] = 'failed'
    receipt['error'] = str(error)
    raise
finally:
    receipt['diskAfter'] = shutil.disk_usage('/')._asdict()
    (root / 'hosted.json').write_text(json.dumps(receipt, indent=2) + '\n')
