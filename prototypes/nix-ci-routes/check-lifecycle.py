#!/usr/bin/env nix
#! nix shell nixpkgs#python3 --command python3
"""Check SIGTERM cleanup during a real payload, then booted runtime boundaries."""
import json
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path('/tmp/nix-ci-routes')
probe = Path(__file__).resolve().parent
results = []
for route in ('yeradon', 'arion'):
    base = [sys.executable, str(probe / 'run-local.py'), route, '--non-root-payload']
    base += ['--image-archive', str(root / 'yeradon-compatible-image')] if route == 'yeradon' else ['--arion-artifacts', str(root / 'arion-compatible-artifacts')]
    previous = set(root.glob(f'{route}-*/receipt.json'))
    with (root / f'{route}-cancellation.log').open('w') as log:
        child = subprocess.Popen(base, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 120
            receipt = None
            while time.monotonic() < deadline and child.poll() is None:
                for path in set(root.glob(f'{route}-*/receipt.json')) - previous:
                    if (path.parent / 'work/.ci-route-output/payload.json').exists():
                        receipt = path
                        break
                if receipt:
                    break
                time.sleep(0.25)
            if receipt is None:
                raise RuntimeError(f'{route}: payload did not start; see cancellation log')
            sent = time.monotonic()
            child.send_signal(signal.SIGTERM)
            exit_code = child.wait(timeout=60)
            record = json.loads(receipt.read_text())
            if exit_code == 0 or not record.get('cancelled') or record['cleanup']['containerExists'] or record['cleanup']['workspaceExists']:
                raise RuntimeError(f'{route}: cancellation/cleanup contract failed: {record}')
            results.append({'route': route, 'scope': 'SIGTERM to harness during real payload; not a GitHub cancellation or power loss', 'secondsAfterSignal': round(time.monotonic() - sent, 3), 'exit': exit_code, 'cleanup': record['cleanup'], 'attempt': receipt.parent.name})
            print(f'CI_ROUTE_CANCELLATION_PASSED {route}', flush=True)
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=60)
    for runtime in ('upstream-runner', 'nixos-runner'):
        subprocess.run(base + ['--smoke-only', '--external-runtime', runtime], check=True, timeout=180)
        print(f'CI_ROUTE_RUNTIME_PROBE_FINISHED {route} {runtime}', flush=True)
(root / 'local-lifecycle.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
