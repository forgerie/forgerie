#!/usr/bin/env node
// Build with `npx tsc -p tsconfig.build.json` first. Only temporary units/data.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const self = fileURLToPath(import.meta.url);
const owner = ['owner', 'attached-owner'].includes(process.argv[2]);
const root = owner ? process.argv[3] : await mkdtemp(join(tmpdir(), 'fg-process-proof %h $HOME \"quote\"-'));
const checkout = owner ? process.argv[4] : resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
// Never persist live provider credentials in this acceptance fixture.
const allowed = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'TZ']);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
const { ManagedProcesses } = await import(pathToFileURL(join(checkout, 'dist/server/processes/managedProcesses.js')));
const { prepareManagedProcessLauncher, AttachedManagedProcessLauncher, managedProcessUnits } = await import(pathToFileURL(join(checkout, 'dist/server/processes/managedProcessLauncher.js')));
const ctl = (...args) => execute('systemctl', ['--user', ...args], { timeout: 15000 });
const show = async (unit, property) => (await ctl('show', unit, '--property='+property, '--value')).stdout.trim();
async function waitFor(read, accept, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await delay(25); }
  throw new Error('Timed out: '+label+'; scratch: '+root);
}
const readOptional = async file => { try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } };
const pidGone = async pid => { const stat = await readOptional('/proc/'+pid+'/stat'); return stat === '' || stat.slice(stat.lastIndexOf(')')+2).startsWith('Z'); };
const ended = snapshot => snapshot.state.kind === 'ended';
const plan = owner ? JSON.parse(await readFile(join(root, 'plan.json'), 'utf8')) : { sessionId: 'proof-'+randomUUID() };
const launcher = process.argv[2] === 'attached-owner' ? new AttachedManagedProcessLauncher() : await prepareManagedProcessLauncher();
const manager = new ManagedProcesses({ stateDirectory: root, sessionId: plan.sessionId, launcher, environment: process.env });

if (owner) {
  await manager.initialize();
  if (process.argv[2] === 'attached-owner') {
    const record = await manager.start({ id: 'attached', cwd: root, stopTimeoutSeconds: 0.2, command: 'echo $$; exec sleep 120' });
    await waitFor(() => readOptional(join(record.directory, 'output.log')), value => /^\d+\n$/.test(value), 'attached PID');
    await writeFile(join(root, 'attached-ready.json'), JSON.stringify(record));
  } else {
    assert.equal(launcher.supervision.kind, 'systemd');
    const record = await manager.start({ id: 'reader', cwd: root, command: 'while IFS= read -r line; do printf "got:%s\\n" "$line"; done; printf "explicit EOF\\n"; exit 7' });
    await waitFor(() => manager.writeStdin(record.id, 'parent writer\n'), value => value.kind === 'written', 'initial stdin');
    const plain = spawn('sleep', ['120'], { stdio: 'ignore' });
    const escaped = spawn('setsid', ['sleep', '120'], { stdio: 'ignore' });
    await writeFile(join(root, 'ready.json'), JSON.stringify({ record, ordinaryPids: [plain.pid, escaped.pid] }));
  }
  setInterval(() => {}, 1000);
} else {
  const parent = 'forgerie-proc-proof-parent-'+randomUUID()+'.service';
  const { slice } = managedProcessUnits(plan.sessionId, 'reader');
  const ownUnits = [];
  let initialized = false;
  let passed = false;
  let attachedOwner;
  try {
    assert.equal(launcher.supervision.kind, 'systemd', 'A Linux systemd user manager is required');
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan), { mode: 0o600 });
    await execute('systemd-run', ['--user', '--collect', '--expand-environment=no', '--unit='+parent, '--property=Type=exec', '--property=KillMode=control-group',
      '--setenv=PATH='+process.env.PATH, '--property=StandardOutput=append:'+join(root, 'owner.log'), '--property=StandardError=inherit',
      '--', process.execPath, self, 'owner', root, checkout], { timeout: 15000 });
    const readyText = await waitFor(() => readOptional(join(root, 'ready.json')), Boolean, 'parent readiness');
    const { record, ordinaryPids } = JSON.parse(readyText);
    ownUnits.push(managedProcessUnits(plan.sessionId, record.id).unit);
    const unit = ownUnits[0];
    const mainPid = await show(unit, 'MainPID');
    const parentCgroup = await show(parent, 'ControlGroup');
    const processCgroup = await show(unit, 'ControlGroup');
    assert.ok(!processCgroup.startsWith(parentCgroup+'/'));
    await ctl('stop', parent);
    assert.equal(await show(unit, 'MainPID'), mainPid);
    assert.equal(await show(unit, 'ActiveState'), 'active');
    for (const pid of ordinaryPids) await waitFor(() => pidGone(pid), Boolean, 'ordinary parent child death');
    // A killed owner cannot release its filesystem lease. Wait for stale expiry.
    await waitFor(async () => { try { await manager.initialize(); return true; } catch (error) { if (error.code === 'ELOCKED') return false; throw error; } }, Boolean, 'stale lease recovery');
    initialized = true;
    assert.equal((await manager.status('reader')).state.kind, 'running');
    assert.deepEqual(await manager.writeStdin('reader', 'new writer\n'), { kind: 'written', bytesWritten: 11 });
    await waitFor(() => readOptional(join(record.directory, 'output.log')), value => value.includes('got:new writer\n'), 'new writer output');
    assert.equal((await manager.status('reader')).state.kind, 'running');
    assert.equal((await manager.closeStdin('reader')).kind, 'written');
    const result = await waitFor(() => manager.status('reader'), ended, 'EOF result');
    assert.deepEqual(result.state.result, { result: 'exit-code', code: 'exited', status: '7' });
    assert.deepEqual((await manager.readOutput('reader')).lines.map(line => line.text), ['got:parent writer', 'got:new writer', 'explicit EOF']);
    console.log('PASS parent KillMode=control-group stopped; ordinary/setsid children died; managed MainPID '+mainPid+' survived in a separate cgroup');
    console.log('PASS recovery: running; new stdin writer worked without EOF; explicit EOF recorded result=exit-code code=exited status=7');

    const start = async spec => { ownUnits.push(managedProcessUnits(plan.sessionId, spec.id).unit); return manager.start({ cwd: root, ...spec }); };
    const killed = await start({ id: 'sigkill', command: 'exec sleep 120' });
    await ctl('kill', '--signal=KILL', '--kill-whom=main', managedProcessUnits(plan.sessionId, killed.id).unit);
    assert.deepEqual((await waitFor(() => manager.status(killed.id), ended, 'SIGKILL result')).state.result, { result: 'signal', code: 'killed', status: 'KILL' });
    console.log('PASS outside SIGKILL recorded result=signal code=killed status=KILL');

    const stubborn = await start({ id: 'stubborn', stopTimeoutSeconds: 0.2, command: 'trap "" TERM; setsid sh -c \'echo $$ > grandchild.pid; trap "" TERM; exec sleep 120\' & echo ready; while :; do sleep 1; done' });
    await waitFor(() => readOptional(join(root, 'grandchild.pid')), Boolean, 'setsid child');
    await waitFor(() => readOptional(join(stubborn.directory, 'output.log')), value => value.includes('ready'), 'TERM handler');
    const beforeStop = Date.now(); await manager.stopSession(); const stopMs = Date.now()-beforeStop;
    const stopped = await waitFor(() => manager.status(stubborn.id), ended, 'slice stop timeout');
    assert.deepEqual(stopped.state.result, { result: 'timeout', code: 'killed', status: 'KILL' });
    const grandchildPid = (await readFile(join(root, 'grandchild.pid'), 'utf8')).trim();
    await waitFor(() => pidGone(grandchildPid), Boolean, 'setsid descendant death');
    console.log('PASS session slice stop returned in '+stopMs+'ms; TimeoutStopSec killed TERM-ignoring main and setsid descendant');

    const full = await start({ id: 'full', command: 'exec sleep 120' });
    const fullResult = await waitFor(() => manager.writeStdin(full.id, Buffer.alloc(1024*1024)), value => value.kind !== 'stdin-closed', 'nonblocking input');
    assert.equal(fullResult.kind, 'stdin-full'); assert.ok(fullResult.bytesWritten > 0);
    await manager.stop(full.id); await waitFor(() => manager.status(full.id), ended, 'full stdin stop');
    console.log('PASS stdin-full returned after '+fullResult.bytesWritten+' bytes; no blocking write');

    // Original spike failed on grep's giant regex. Inspect bytes directly instead.
    await writeFile(join(root, 'long-lines.py'), `import os, threading\nbarrier=threading.Barrier(2)\ndef write(fd,ch):\n for _ in range(50):\n  barrier.wait()\n  data=ch*100000+b'\\n'\n  assert os.write(fd,data)==len(data)\na=threading.Thread(target=write,args=(1,b'A')); b=threading.Thread(target=write,args=(2,b'B')); a.start(); b.start(); a.join(); b.join()\n`);
    const atomic = await start({ id: 'longlines', command: 'exec python3 long-lines.py' });
    await waitFor(() => manager.status(atomic.id), ended, 'large concurrent writes');
    const lines = (await manager.readOutput(atomic.id)).lines;
    assert.equal(lines.length, 100);
    const mixed = lines.filter(line => !/^A+$/.test(line.text) && !/^B+$/.test(line.text));
    assert.ok(lines.every(line => line.text.length === 100000));
    console.log('OBSERVED concurrent stdout/stderr: '+lines.length+' lines of 100000 bytes, '+mixed.length+' mixed lines (one write per line)');
    await writeFile(join(root, 'split-lines.py'), `import os,threading\nb=threading.Barrier(2)\ndef write(fd,ch):\n os.write(fd,ch*50000); b.wait(); os.write(fd,ch*50000+b'\\n')\na=threading.Thread(target=write,args=(1,b'A')); c=threading.Thread(target=write,args=(2,b'B')); a.start(); c.start(); a.join(); c.join()\n`);
    const split = await start({ id: 'splitlines', command: 'exec python3 split-lines.py' });
    await waitFor(() => manager.status(split.id), ended, 'split concurrent writes');
    const splitLines = (await manager.readOutput(split.id)).lines;
    const splitMixed = splitLines.filter(line => line.text.includes('A') && line.text.includes('B')).length;
    assert.ok(splitMixed > 0);
    console.log('OBSERVED two 100000-byte logical lines split across writes: '+splitMixed+' mixed line(s); reader preserves merged bytes and newline order, never invents stream boundaries');

    const unusual = join(root, 'cwd %h $HOME "quote"'); await mkdir(unusual);
    const env = await start({ id: 'environment', cwd: unusual, command: 'printf "%s\\n" "$PWD" "$PATH" \'$HOME\' "$PYTHONUNBUFFERED" "${INVOCATION_ID-unset}" "${SYSTEMD_EXEC_PID-unset}"; printf no-newline' });
    await waitFor(() => manager.status(env.id), ended, 'environment and quoted paths');
    assert.deepEqual((await manager.readOutput(env.id)).lines.map(line => line.text), [unusual, process.env.PATH, '$HOME', '1', 'unset', 'unset', 'no-newline']);
    console.log('PASS PATH, literal dollars, percent/space/quote cwd, unbuffering defaults and final unterminated line');

    await manager.dispose(); initialized = false;
    attachedOwner = spawn(process.execPath, [self, 'attached-owner', root, checkout], { stdio: 'inherit' });
    const attachedRecord = JSON.parse(await waitFor(() => readOptional(join(root, 'attached-ready.json')), Boolean, 'attached launch'));
    const attachedPid = (await readFile(join(attachedRecord.directory, 'output.log'), 'utf8')).trim();
    attachedOwner.kill('SIGKILL');
    await waitFor(() => pidGone(attachedPid), Boolean, 'attached parent-death lifeline');
    console.log('PASS attached process ended after its Forgerie parent received SIGKILL (lifeline, not stdin)');
    passed = true;
  } finally {
    attachedOwner?.kill('SIGKILL');
    // Stop only identities from this proof. Never touch deployed Forgerie units.
    await ctl('stop', parent).catch(() => undefined);
    await ctl('stop', slice).catch(() => undefined);
    for (const unit of ownUnits) await ctl('reset-failed', unit).catch(() => undefined);
    if (initialized) await manager.dispose();
    const remaining = (await ctl('list-units', 'forgerie-proc*', '--all', '--no-legend', '--plain')).stdout.trim();
    // Remove the automatic empty ancestor only if no other session uses it.
    if (remaining !== '' && remaining.split('\n').every(line => line.trim().startsWith('forgerie-proc.slice '))) await ctl('stop', 'forgerie-proc.slice');
    const final = (await ctl('list-units', 'forgerie-proc*', '--all', '--no-legend', '--plain')).stdout.trim();
    assert.ok(!final.includes(slice) && !final.includes(parent));
    for (const unit of ownUnits) assert.ok(!final.includes(unit));
    console.log('CLEANUP systemctl --user list-units forgerie-proc* --all: '+(final || '(none)'));
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error('Retained proof files for inspection: '+root);
  }
}
