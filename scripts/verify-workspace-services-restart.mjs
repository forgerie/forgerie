#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const execute = promisify(execFile);
const self = fileURLToPath(import.meta.url);
const ownerMode = process.argv[2] === 'owner';
const root = ownerMode ? process.argv[3] : await mkdtemp(join(tmpdir(), 'fg-boot-'));
const checkout = ownerMode ? process.argv[4] : resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
// Only operational values enter this acceptance process. Never copy live provider credentials into a test launch file.
const allowed = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'TZ', 'NIX_PATH', 'NIX_REMOTE', 'NIX_SSL_CERT_FILE', 'INVOCATION_ID']);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
process.env.PI_WEB_CONFIG = join(root, 'unused-config.json');
process.env.PI_WEB_DATA_DIR = root;
const { SessionWorktreeStore } = await import(pathToFileURL(join(checkout, 'dist/server/workspaces/sessionWorktreeStore.js')));
const { WorkspaceServices } = await import(pathToFileURL(join(checkout, 'dist/server/workspaces/workspaceServices.js')));
const store = new SessionWorktreeStore(join(root, 'worktrees.json'));
await store.initialize();
const manager = new WorkspaceServices({ directory: join(root, 'services'), worktrees: store, onError: error => { process.stderr.write(error.message+'\n'); } });
if (ownerMode) {
  const { id } = JSON.parse(await readFile(join(root, 'plan.json'), 'utf8'));
  await manager.initialize();
  process.once('SIGTERM', () => { void manager.dispose().finally(() => process.exit(0)); });
  const snapshot = await manager.action(id, { action: 'start', approve: true });
  const ready = await manager.wait(id, { timeoutMs: 10000 });
  assert.equal(ready.kind, 'ready');
  await writeFile(join(root, 'ready.json'), JSON.stringify(snapshot), { mode: 0o600 });
  setInterval(() => {}, 1000);
} else {
  const parent = 'forgerie-workspace-proof-'+randomUUID()+'.service';
  let initialized = false;
  let id;
  try {
    await mkdir(join(root, 'agent'), { mode: 0o700 });
    const repo = join(root, 'repo'); await mkdir(join(repo, '.forgerie'), { recursive: true });
    await writeFile(join(repo, '.forgerie/config.json'), JSON.stringify({ version: 2, env: 'none', services: { file: 'process-compose.yaml', ports: ['web'] } }));
    await writeFile(join(repo, 'server.mjs'), "import http from 'node:http'; import fs from 'node:fs'; fs.writeFileSync(process.env.FORGERIE_STATE_DIR+'/retained','kept'); http.createServer((req,res)=>res.end('independent')).listen(Number(process.env.FORGERIE_PORT_WEB),'127.0.0.1');");
    await writeFile(join(repo, 'process-compose.yaml'), `version: '0.5'\nprocesses:\n  web:\n    command: '${process.execPath} server.mjs'\n    readiness_probe:\n      http_get:\n        host: 127.0.0.1\n        port: \${FORGERIE_PORT_WEB}\n        path: /\n      initial_delay_seconds: 0\n      period_seconds: 1\n`);
    const git = (...args) => execute('git', ['-C', repo, ...args], { timeout: 10000 });
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Acceptance'); await git('config', 'user.email', 'acceptance@example.invalid'); await git('add', '.'); await git('commit', '-m', 'controlled services');
    const { SessionWorktrees } = await import(pathToFileURL(join(checkout, 'dist/server/workspaces/sessionWorktrees.js')));
    // Related worktrees finish setup without a Pi session start. A primary worktree remains in `starting` until attach().
    const worktree = await new SessionWorktrees(store).create(repo, undefined, undefined, { id: randomUUID(), cwd: repo, projectId: 'acceptance-project' }); id = worktree.id;
    assert.equal(worktree.setup.phase, 'done');
    await writeFile(join(root, 'plan.json'), JSON.stringify({ id }), { mode: 0o600 });
    await writeFile(join(root, 'owner.log'), '', { mode: 0o600 });
    await execute('systemd-run', ['--user', '--quiet', '--collect', '--unit='+parent, '--property=Type=exec', '--property=KillMode=control-group', '--setenv=PATH='+process.env.PATH, '--property=StandardOutput=append:'+join(root, 'owner.log'), '--property=StandardError=inherit', '--', process.execPath, self, 'owner', root, checkout]);
    const deadline = Date.now()+120000;
    let ready;
    while (Date.now()<deadline) {
      try { ready = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8')); break; }
      catch (error) {
        if(error.code!=='ENOENT')throw error;
        const { stdout } = await execute('systemctl', ['--user', 'show', parent, '--property=ActiveState', '--value']);
        if (!['active', 'activating'].includes(stdout.trim())) throw new Error('Launching test unit exited before readiness. Inspect '+join(root, 'owner.log'));
        await delay(100);
      }
    }
    assert.ok(ready, 'Launching unit did not reach readiness');
    const inventory = JSON.parse(await readFile(join(root, 'services/instances.json'), 'utf8'));
    const instance = inventory.find(record => record.worktreeId === id);
    assert.equal(instance.owner.kind, 'systemd');
    const { stdout: parentGroup } = await execute('systemctl', ['--user', 'show', parent, '--property=ControlGroup', '--value']);
    const { stdout: childGroup } = await execute('systemctl', ['--user', 'show', instance.owner.unit, '--property=ControlGroup', '--value']);
    assert.ok(parentGroup.trim()); assert.ok(childGroup.trim());
    assert.notEqual(parentGroup.trim(), childGroup.trim());
    assert.ok(!childGroup.trim().startsWith(parentGroup.trim()+'/'));
    await execute('systemctl', ['--user', 'stop', parent]);
    await manager.initialize(); initialized = true;
    const resumed = await manager.status(id); assert.equal(resumed.kind, 'running');
    assert.deepEqual(resumed.ports, ready.ports);
    assert.equal(await (await fetch('http://127.0.0.1:'+resumed.ports.web+'/')).text(), 'independent');
    assert.equal(await readFile(join(resumed.stateDirectory, 'retained'), 'utf8'), 'kept');
    const runtime = await realpath(join(root, 'services/runtime'));
    assert.match(runtime, /^\/nix\/store\/.+process-compose-1\.120\.0$/);
    await manager.beforeRemoval(id);
    assert.equal((await manager.status(id)).kind, 'stopped');
    console.log(JSON.stringify({ result: 'passed', launchingUnitStopped: parent, serviceUnit: instance.owner.unit, parentCgroup: parentGroup.trim(), serviceCgroup: childGroup.trim(), portPreserved: resumed.ports.web, retainedData: true, pinnedRuntimeRoot: runtime, scratchDirectory: root }));
  } finally {
    await execute('systemctl', ['--user', 'stop', parent]).catch(() => undefined);
    if (initialized && id !== undefined) { await manager.beforeRemoval(id); await manager.dispose(); }
    else { console.error('Retained scratch directory for inspection:',root); }
    if (initialized) await rm(root, { recursive: true, force: true });
  }
}
