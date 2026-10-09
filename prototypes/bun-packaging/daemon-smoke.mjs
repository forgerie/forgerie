#!/usr/bin/env nix-shell
/*
#! nix-shell -i node -p nodejs_24
*/
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = process.argv[2];
const label = process.argv[3];
const exe = runtime === 'bun' ? '/tmp/forgerie-bun-spikes/bun-1.4.2' : process.execPath;
const entry = process.argv[4] ?? join(repo, 'dist/server/sessiond.js');
const results = [];
const root = join('/tmp/forgerie-bun-spikes', label);
await mkdir(root, { recursive: true });
let failure;
try {
  for (const transport of ['tcp', 'unix']) {
    results.push(await smoke(transport));
  }
} catch (error) {
  failure = String(error.stack ?? error);
} finally {
  await writeFile(join(root, 'result.json'), JSON.stringify({ runtime, exe, entry, results, failure: failure ?? null }, null, 2) + '\n');
}
console.log(JSON.stringify({ runtime, results, failure: failure ?? null }, null, 2));
if (failure) process.exitCode = 1;

async function smoke(transport) {
  const state = await mkdtemp(join(root, `${transport}-`));
  const project = join(state, 'project');
  const agentDir = join(state, 'agent');
  await mkdir(project);
  await mkdir(join(agentDir, 'extensions'), { recursive: true });
  // Load an actual external extension without importing private SDK code.
  await writeFile(join(agentDir, 'extensions', 'probe.js'), `export default function(pi) {
    pi.registerCommand('spike-probe', { description: 'Write a probe marker', handler: async (_, ctx) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(ctx.cwd + '/extension-marker.txt', 'external extension ran');
    }});
  }\n`);
  const port = transport === 'tcp' ? await freePort() : undefined;
  const socketPath = join(state, 'sessiond.sock');
  const target = transport === 'tcp' ? { hostname: '127.0.0.1', port } : { socketPath };
  const allowed = ['PATH', 'TMPDIR', 'LANG', 'TZ', 'SHELL'];
  const env = Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  Object.assign(env, { HOME: state, XDG_CONFIG_HOME: join(state, 'config'), XDG_DATA_HOME: join(state, 'data'),
    PI_CODING_AGENT_DIR: agentDir, PI_WEB_AGENT_DIR: agentDir, PI_WEB_DATA_DIR: join(state, 'web-data'),
    PI_WEB_CONFIG: join(state, 'config.json'), PI_OFFLINE: '1', PI_WEB_OFFLINE: '1',
    PI_WEB_SESSIOND_SOCKET: socketPath, PI_WEB_SESSIOND_HOST: '127.0.0.1',
    CLIPROXYAPI_API_KEY: '', CLIPROXYAPI_BASE_URL: '',
    ...(port === undefined ? {} : { PI_WEB_SESSIOND_PORT: String(port) }) });
  let child;
  const connections = [];
  const start = async (generation) => {
    const args = process.argv[4] ? [] : [entry];
    child = spawn(process.argv[4] ?? exe, args, { cwd: state, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(createWriteStream(join(state, `stdout-${generation}.log`)));
    child.stderr.pipe(createWriteStream(join(state, `stderr-${generation}.log`)));
    const began = performance.now();
    await until(async () => {
      if (child.exitCode !== null) throw new Error(`Daemon exited ${child.exitCode}`);
      try { return (await request('/health')).body.ok === true; } catch { return false; }
    }, 30_000);
    return performance.now() - began;
  };
  const request = async (path, body, expected = 200) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const result = await new Promise((accept, reject) => {
      const req = http.request({ ...target, path, method: body === undefined ? 'GET' : 'POST',
        headers: json === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) },
        timeout: 10_000 }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (value) => { data += value; });
        res.on('end', () => { try { accept({ status: res.statusCode, body: JSON.parse(data) }); } catch (error) { reject(error); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('request timeout')); });
      req.end(json);
    });
    assert.equal(result.status, expected, JSON.stringify(result));
    return result;
  };
  const connect = async () => {
    const ws = transport === 'tcp' ? new WebSocket(`ws://127.0.0.1:${port}/events`) : new WebSocket(`ws+unix://${socketPath}:/events`);
    connections.push(ws);
    await Promise.race([once(ws, 'open'), timeout(10_000, 'websocket did not open')]);
    return ws;
  };
  const stop = async () => {
    for (const ws of connections.splice(0)) ws.terminate();
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const [code, signal] = await Promise.race([exited, timeout(10_000, 'SIGTERM did not settle')]);
    assert.equal(code, 0, `shutdown ${code} ${signal}`);
  };
  try {
    const startupMs = await start(1);
    assert.equal((await request('/health')).body.activeSessions, 0);
    await request('/sessions', undefined, 400);
    const ws = await connect();
    const event = new Promise((accept, reject) => {
      const listener = (data) => {
        try {
          const payload = JSON.parse(String(data));
          if (payload.type === 'session.created') { ws.off('message', listener); accept(payload); }
        } catch (error) { reject(error); }
      };
      ws.on('message', listener);
    });
    const { body: session } = await request('/sessions', { cwd: project, destination: { kind: 'existing-workspace' }, startupToken: 'spike' });
    assert.equal(typeof session.id, 'string');
    const eventPayload = await Promise.race([event, timeout(10_000, 'no creation event')]);
    assert.equal(eventPayload.type, 'session.created');
    const query = `?cwd=${encodeURIComponent(project)}`;
    const prefix = `/sessions/${encodeURIComponent(session.id)}`;
    await request(prefix + '/status' + query);
    const commands = await request(prefix + '/commands' + query);
    assert.ok(JSON.stringify(commands.body).includes('spike-probe'), 'external command missing');
    await request(prefix + '/commands/run', { cwd: project, text: '/spike-probe' });
    await until(async () => { try { return (await readFile(join(project, 'extension-marker.txt'), 'utf8')) === 'external extension ran'; } catch { return false; } }, 10_000);
    await request(prefix + '/shell', { cwd: project, text: "!printf 'real child process' > shell-marker.txt" });
    await until(async () => { try { return (await readFile(join(project, 'shell-marker.txt'), 'utf8')) === 'real child process'; } catch { return false; } }, 10_000);
    ws.terminate();
    await connect();
    await request(prefix + '/stream-snapshot' + query);
    await stop();
    const restartMs = await start(2);
    const catalog = (await request('/sessions/all')).body;
    assert.ok(JSON.stringify(catalog).includes(session.id), 'session missing after restart');
    await request(prefix + '/status' + query);
    await connect();
    await stop();
    return { transport, startupMs, restartMs, sessionId: session.id, checks: ['health', 'HTTP validation', 'WebSocket event and reconnect', 'session creation', 'external extension command', 'shell subprocess', 'restart discovery', 'SIGTERM cleanup'] };
  } finally {
    connections.forEach((ws) => ws.terminate());
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
}
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((accept) => { server.close(accept); });
  return port;
}
function timeout(ms, message) {
  return new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(message)), ms); timer.unref(); });
}
async function until(check, ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (await check()) return;
    await new Promise((accept) => setTimeout(accept, 50));
  }
  throw new Error(`Condition did not settle in ${ms}ms`);
}
