#!/usr/bin/env nix
#! nix shell nixpkgs#python3 nixpkgs#git --command python3
"""Verify the running worktree API using disposable repositories and shell-only Pi history."""
import argparse
import json
import pathlib
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:8504/api')
parser.add_argument('--out', required=True)
args = parser.parse_args()
base = args.base_url.rstrip('/')
root = pathlib.Path(tempfile.mkdtemp(prefix='forgerie-worktree-live-'))
repo = root / 'repo'
repo.mkdir()
created = []
results = []
cleanup_errors = []


def api(method, path, body=None, allow_error=False):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        value = json.load(error)
        if allow_error:
            return error.code, value
        raise RuntimeError(f'{method} {path}: HTTP {error.code}: {value}') from error


def git(cwd, *commands):
    return subprocess.run(['git', '-C', str(cwd), *commands], check=True, text=True, capture_output=True).stdout.strip()


def ref_path(session, suffix):
    return '/sessions/' + session['id'] + suffix


def read(session, suffix):
    query = urllib.parse.urlencode({'cwd': session['cwd']})
    return api('GET', ref_path(session, suffix) + '?' + query)[1]


def make_session():
    session = api('POST', '/sessions', {'cwd': str(repo), 'startupToken': str(uuid.uuid4())})[1]
    created.append(session)
    assert session['cwd'] != str(repo), session
    assert session['worktree']['owned'] and session['worktree']['setup']['phase'] == 'done', session
    worktree = pathlib.Path(session['cwd'])
    assert worktree.joinpath('setup-proof').read_text().strip() == str(worktree)
    api('POST', ref_path(session, '/shell'), {'cwd': session['cwd'], 'text': "!printf 'worktree live acceptance\\n'"})
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        status = read(session, '/status')
        if status.get('persisted') and not status['isBashRunning'] and read(session, '/messages')['total'] > 0:
            return session
        time.sleep(0.1)
    raise RuntimeError('Shell-only transcript did not persist')


def check_readonly(session, expected):
    status = read(session, '/status')
    messages = read(session, '/messages')
    assert status['readOnly'] and status['worktree']['state']['kind'] == expected, status
    assert messages['total'] > 0, messages
    assert read(session, '/stream-snapshot')['partial'] is None
    code, error = api('POST', ref_path(session, '/prompt'), {'cwd': session['cwd'], 'text': 'Must not run'}, allow_error=True)
    assert code >= 400 and 'read-only' in error.get('error', ''), (code, error)
    assert not pathlib.Path(session['cwd']).exists(), session
    return {'readOnly': status['readOnly'], 'state': status['worktree']['state'], 'messageCount': messages['total'], 'promptRejected': code}


git(repo, 'init', '-b', 'main')
git(repo, 'config', 'user.name', 'Forgerie live acceptance')
git(repo, 'config', 'user.email', 'acceptance@example.invalid')
repo.joinpath('README.txt').write_text('base\n')
repo.joinpath('.gitignore').write_text('setup-proof\n')
hooks = repo / '.forgerie/hooks'
hooks.mkdir(parents=True)
post = hooks / 'worktree-post-create'
post.write_text('#!/bin/sh\nset -eu\nprintf "%s\\n" "$PWD" > setup-proof\nprintf "setup cwd: %s\\n" "$PWD"\n')
post.chmod(0o755)
pre = hooks / 'worktree-pre-remove'
pre.write_text('#!/bin/sh\nset -eu\nprintf "remove target: %s\\n" "$1"\n')
pre.chmod(0o755)
git(repo, 'add', '.')
git(repo, 'commit', '-m', 'Acceptance base')
original_ignore = repo.joinpath('.gitignore').read_text()
options = api('GET', '/sessions/worktree-options?' + urllib.parse.urlencode({'cwd': str(repo)}))[1]
assert options['defaultDestination'] == 'fresh-worktree' and options['defaultBranch'] == 'main', options

try:
    landed = make_session()
    pathlib.Path(landed['cwd'], 'README.txt').write_text('landed\n')
    git(landed['cwd'], 'add', 'README.txt')
    git(landed['cwd'], 'commit', '-m', 'Acceptance landed commit')
    info = api('GET', '/sessions/worktrees/' + landed['worktree']['id'])[1]['info']
    assert info['ahead'] == 1 and info['dirtyFiles'] == 0, info
    outcome = api('POST', '/sessions/worktrees/' + landed['worktree']['id'] + '/land', {})[1]
    assert outcome['kind'] == 'landed' and outcome['cleanup']['kind'] == 'done', outcome
    assert repo.joinpath('README.txt').read_text() == 'landed\n'
    results.append({'case': 'land', 'outcome': outcome, **check_readonly(landed, 'landed')})

    discarded = make_session()
    pathlib.Path(discarded['cwd'], 'README.txt').write_text('discarded\n')
    git(discarded['cwd'], 'add', 'README.txt')
    git(discarded['cwd'], 'commit', '-m', 'Acceptance unlanded commit')
    prefix = '/sessions/worktrees/' + discarded['worktree']['id']
    preview = api('POST', prefix + '/discard-preview', {})[1]
    assert len(preview['commits']) == 1, preview
    outcome = api('POST', prefix + '/discard', {'confirmationToken': preview['confirmationToken']})[1]
    assert outcome['kind'] == 'discarded' and outcome['cleanup']['kind'] == 'done', outcome
    assert repo.joinpath('README.txt').read_text() == 'landed\n'
    results.append({'case': 'discard', 'outcome': outcome, **check_readonly(discarded, 'discarded')})

    archived = make_session()
    api('POST', ref_path(archived, '/archive'), {'cwd': archived['cwd']})
    record = api('GET', '/sessions/worktrees/' + archived['worktree']['id'])[1]['worktree']
    assert record['archiveCleanup']['kind'] == 'removed' and record['cleanup']['kind'] == 'done', record
    results.append({'case': 'archive', 'cleanup': record['archiveCleanup'], **check_readonly(archived, 'landed')})
    assert git(repo, 'status', '--porcelain') == ''
    assert repo.joinpath('.gitignore').read_text() == original_ignore
    assert '/.worktree/' in repo.joinpath('.git/info/exclude').read_text()
finally:
    # Remove only conversations this script created. Keep the disposable main repo and receipt evidence.
    for session in created:
        status = read(session, '/status')
        if not status.get('readOnly'):
            continue
        api('POST', ref_path(session, '/archive'), {'cwd': session['cwd']})
        deletion = api('POST', '/sessions/bulk/delete-archived', {'sessions': [{'id': session['id'], 'cwd': session['cwd']}]}, allow_error=True)
        if deletion[0] >= 400 or session['id'] not in deletion[1].get('deletedSessionIds', []):
            cleanup_errors.append(deletion)
            print('Conversation cleanup needs attention:', deletion)
    evidence = {'baseUrl': base, 'repo': str(repo), 'cases': results, 'sessionIds': [session['id'] for session in created], 'cleanupErrors': cleanup_errors}
    output = pathlib.Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))

assert len(results) == 3 and not cleanup_errors
