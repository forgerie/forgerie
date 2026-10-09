#!/usr/bin/env nix-shell
/*
#! nix-shell -i node -p nodejs_24
*/
// Real loopback HTTP/TLS/proxy comparisons. No provider or public network access.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { brotliCompressSync, deflateSync, gzipSync, createGzip, constants } from 'node:zlib';
import { installHttpAdapter, undici } from './http-adapter.mjs';

const mode = process.argv[2];
const native = mode === 'native';
const configuration = native ? {} : installHttpAdapter(mode);
const module = native ? 'agentHttpDispatcher.js' : 'agentHttpDispatcher.spike.js';
const { configureAgentHttpDispatcher } = await import(`../../dist/server/sessiond/${module}`);
const dispatcherApi = native ? await import('undici') : undici;
const savedDispatcher = dispatcherApi.getGlobalDispatcher();
const dispatchers = new Set();
const servers = [];
const sockets = new Set();
const timers = new Set();
const hits = new Map();
const closed = new Set();
const proxyHits = [];
const checks = [];
const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'ALL_PROXY', 'all_proxy'];
const report = { mode, configuration, runtime: { node: process.versions.node, bun: process.versions.bun ?? null },
  installedUndici: JSON.parse(readFileSync(new URL('../../node_modules/undici/package.json', import.meta.url))).version,
  checks };

function later(action, ms) {
  const timer = setTimeout(() => { timers.delete(timer); action(); }, ms);
  timers.add(timer);
  return timer;
}
function serve(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const id = url.searchParams.get('id') ?? url.pathname;
  hits.set(id, (hits.get(id) ?? 0) + 1);
  response.once('close', () => { closed.add(id); });
  const end = (body) => { if (!response.destroyed) response.end(body); };
  if (url.pathname === '/headers') { later(() => { end('after-gap'); }, 1500); return; }
  if (url.pathname === '/stall') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.write('first;');
    later(() => { end('second'); }, 1500);
    return;
  }
  if (url.pathname === '/progress') {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: 0\n\n');
    for (let i = 1; i <= 10; i++) later(() => { if (!response.destroyed) response.write(`data: ${i}\n\n`); }, 200 * i);
    later(() => { end(); }, 2100);
    return;
  }
  if (url.pathname === '/reset') {
    response.write('first;'); later(() => { response.destroy(); }, 100); return;
  }
  if (url.pathname === '/json') {
    const encoding = url.searchParams.get('encoding');
    const encode = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync }[encoding];
    response.writeHead(200, { 'content-encoding': encoding, 'content-type': 'application/json' });
    end(encode(JSON.stringify({ ok: true, unicode: 'café' })));
    return;
  }
  if (url.pathname === '/compressed-stream') {
    response.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/event-stream' });
    const gzip = createGzip();
    gzip.on('error', () => {});
    response.once('close', () => { gzip.destroy(); });
    gzip.pipe(response);
    gzip.write('data: first\n\n'); gzip.flush(constants.Z_SYNC_FLUSH);
    later(() => { if (!gzip.destroyed) gzip.end('data: second\n\n'); }, 400);
    return;
  }
  if (url.pathname === '/upload') {
    const chunks = [];
    request.on('data', (chunk) => { chunks.push(chunk); });
    request.on('end', () => { end(Buffer.concat(chunks)); });
    return;
  }
  response.setHeader('content-type', 'application/json');
  end(JSON.stringify({ ok: true }));
}
async function listen(server) {
  servers.push(server);
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); }); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
function configure(timeoutMs, env = {}) {
  for (const key of proxyKeys) delete process.env[key];
  Object.assign(process.env, env);
  configureAgentHttpDispatcher(timeoutMs);
  const dispatcher = dispatcherApi.getGlobalDispatcher();
  if (typeof dispatcher.close === 'function') dispatchers.add(dispatcher);
}
async function check(name, action) {
  const began = performance.now();
  let deadline;
  try {
    const bounded = new Promise((_, reject) => { deadline = setTimeout(() => { reject(new Error('Probe action did not settle within 6000ms')); }, 6000); });
    const detail = await Promise.race([action(), bounded]);
    checks.push({ name, passed: true, elapsedMs: performance.now() - began, detail });
  } catch (error) { checks.push({ name, passed: false, elapsedMs: performance.now() - began,
    error: { name: error.name, message: error.message, causeCode: error.cause?.code, stack: error.stack } }); }
  finally { clearTimeout(deadline); }
  process.stderr.write(`[http-adapter] ${name}: ${checks.at(-1).passed ? 'passed' : 'failed'}\n`);
}
async function rejectsWithCode(action, expected) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  assert.equal(failure?.cause?.code, expected);
  return { name: failure.name, message: failure.message, causeCode: failure.cause.code };
}
async function waitClosed(id) {
  const deadline = performance.now() + 1500;
  while (!closed.has(id) && performance.now() < deadline) await delay(10);
  assert.ok(closed.has(id), `origin connection not closed for ${id}`);
}

try {
  const port = await listen(http.createServer(serve));
  const origin = `http://127.0.0.1:${port}`;
  const tlsPort = await listen(https.createServer({ key: readFileSync(process.env.SPIKE_TLS_KEY),
    cert: readFileSync(process.env.SPIKE_TLS_CERT) }, serve));
  const tlsOrigin = `https://127.0.0.1:${tlsPort}`;
  const proxy = http.createServer((request, response) => {
    const target = new URL(request.url);
    if (target.origin !== origin) { response.writeHead(403); response.end('loopback fixture only'); return; }
    proxyHits.push({ authority: target.host, transport: 'forward',
      authenticated: request.headers['proxy-authorization'] === `Basic ${Buffer.from('probe:fixture').toString('base64')}` });
    const headers = { ...request.headers };
    delete headers['proxy-authorization'];
    const upstream = http.request(target, { method: request.method, headers }, (incoming) => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    upstream.on('error', () => { response.destroy(); });
    response.once('close', () => { upstream.destroy(); });
    request.pipe(upstream);
  });
  proxy.on('connect', (request, client, head) => {
    const authority = request.url;
    proxyHits.push({ authority, transport: 'connect', authenticated: request.headers['proxy-authorization'] === `Basic ${Buffer.from('probe:fixture').toString('base64')}` });
    // Fail closed: the local fixture is not an open proxy or a credential-forwarding service.
    const allowed = [`127.0.0.1:${port}`, `127.0.0.1:${tlsPort}`];
    if (!allowed.includes(authority)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = net.connect(Number(authority.split(':')[1]), '127.0.0.1');
    sockets.add(upstream);
    upstream.once('close', () => { sockets.delete(upstream); });
    upstream.on('error', () => { client.destroy(); });
    client.on('error', () => { upstream.destroy(); });
    client.once('close', () => { upstream.destroy(); });
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
  });
  const proxyPort = await listen(proxy);
  const proxyUrl = `http://probe:fixture@127.0.0.1:${proxyPort}`;

  await check('idle body terminates with configured timeout', async () => {
    configure(300);
    const response = await fetch(origin + '/stall?id=idle');
    const detail = await rejectsWithCode(() => response.text(), 'UND_ERR_BODY_TIMEOUT');
    await waitClosed('idle'); return detail;
  });
  await check('idle headers terminate with configured timeout', async () => {
    configure(300);
    return rejectsWithCode(() => fetch(origin + '/headers?id=headers-timeout'), 'UND_ERR_HEADERS_TIMEOUT');
  });
  await check('zero disables body timeout across 1500ms gap', async () => {
    configure(0); assert.equal(await (await fetch(origin + '/stall')).text(), 'first;second');
  });
  await check('zero disables headers timeout across 1500ms gap', async () => {
    configure(0); assert.equal(await (await fetch(origin + '/headers')).text(), 'after-gap');
  });
  await check('active stream survives longer than idle budget', async () => {
    configure(300); const body = await (await fetch(origin + '/progress')).text();
    assert.equal(body.split('data: ').length - 1, 11);
  });
  await check('already-aborted request never reaches origin', async () => {
    configure(0); const controller = new AbortController(); controller.abort();
    await assert.rejects(fetch(origin + '/?id=preabort', { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(hits.get('preabort'), undefined);
  });
  await check('abort while waiting for headers', async () => {
    configure(0); const controller = new AbortController();
    later(() => { controller.abort(); }, 100);
    await assert.rejects(fetch(origin + '/headers?id=abort-headers', { signal: controller.signal }), { name: 'AbortError' });
    await waitClosed('abort-headers');
  });
  await check('AbortSignal.timeout is propagated', async () => {
    configure(0);
    await assert.rejects(fetch(origin + '/headers?id=signal-timeout', { signal: AbortSignal.timeout(100) }), { name: 'TimeoutError' });
    await waitClosed('signal-timeout');
  });
  await check('abort after first streamed body chunk', async () => {
    configure(0); const controller = new AbortController();
    const reader = (await fetch(origin + '/stall?id=abort-body', { signal: controller.signal })).body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first;');
    controller.abort(); await assert.rejects(reader.read(), { name: 'AbortError' });
    await waitClosed('abort-body');
  });
  await check('reader cancellation closes origin response', async () => {
    configure(0); const reader = (await fetch(origin + '/stall?id=cancel-body')).body.getReader();
    await reader.read(); await reader.cancel('cancelled'); await waitClosed('cancel-body');
  });
  await check('mid-stream socket failure rejects body', async () => {
    configure(0); const response = await fetch(origin + '/reset');
    await assert.rejects(response.text(), { name: 'TypeError' });
  });
  for (const encoding of ['gzip', 'deflate', 'br']) await check(`${encoding} JSON decompresses`, async () => {
    configure(0); assert.deepEqual(await (await fetch(origin + `/json?encoding=${encoding}`)).json(), { ok: true, unicode: 'café' });
  });
  await check('gzip SSE delivers first event before stream ends', async () => {
    configure(0); const response = await fetch(origin + '/compressed-stream?id=sse');
    const reader = response.body.getReader(); let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    assert.equal(text, 'data: first\n\n'); assert.equal(closed.has('sse'), false);
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
    assert.equal(text, 'data: first\n\ndata: second\n\n');
  });
  await check('Response clone and global constructor agree', async () => {
    configure(0); const response = await fetch(origin);
    assert.ok(response instanceof Response); assert.deepEqual(await response.clone().json(), await response.json());
  });
  await check('Request and FormData upload', async () => {
    configure(0); const form = new FormData(); form.set('message', 'fixture-upload');
    const response = await fetch(new Request(origin + '/upload', { method: 'POST', body: form }));
    assert.ok((await response.text()).includes('fixture-upload'));
  });
  await check('ReadableStream upload with duplex half', async () => {
    configure(0); const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('chunk-upload')); controller.close(); } });
    assert.equal(await (await fetch(origin + '/upload', { method: 'POST', body, duplex: 'half' })).text(), 'chunk-upload');
  });
  await check('TLS validates locally trusted CA', async () => {
    configure(0); assert.deepEqual(await (await fetch(tlsOrigin)).json(), { ok: true });
  });
  for (const [name, url, env] of [
    ['HTTP_PROXY', origin, { HTTP_PROXY: proxyUrl }],
    ['http_proxy', origin, { http_proxy: proxyUrl }],
    ['HTTPS_PROXY', tlsOrigin, { HTTPS_PROXY: proxyUrl }],
    ['https_proxy', tlsOrigin, { https_proxy: proxyUrl }],
  ]) await check(`${name} routing and fixture proxy auth`, async () => {
    configure(0, env); const before = proxyHits.length;
    assert.deepEqual(await (await fetch(url)).json(), { ok: true });
    assert.equal(proxyHits.length, before + 1); assert.ok(proxyHits.at(-1).authenticated);
  });
  await check('NO_PROXY bypasses configured proxy', async () => {
    configure(0, { HTTP_PROXY: proxyUrl, NO_PROXY: '127.0.0.1' }); const before = proxyHits.length;
    assert.deepEqual(await (await fetch(origin)).json(), { ok: true }); assert.equal(proxyHits.length, before);
  });
  await check('lowercase proxy settings take precedence', async () => {
    configure(0, { HTTP_PROXY: 'http://127.0.0.1:1', http_proxy: proxyUrl, NO_PROXY: '*', no_proxy: 'no-match.invalid' });
    const before = proxyHits.length; await (await fetch(origin)).text(); assert.equal(proxyHits.length, before + 1);
  });
  await check('compressed JSON through TLS proxy', async () => {
    configure(0, { HTTPS_PROXY: proxyUrl });
    assert.deepEqual(await (await fetch(tlsOrigin + '/json?encoding=gzip')).json(), { ok: true, unicode: 'café' });
  });
  await check('idle timeout through TLS proxy', async () => {
    configure(300, { HTTPS_PROXY: proxyUrl });
    const response = await fetch(tlsOrigin + '/stall?id=tls-idle');
    return rejectsWithCode(() => response.text(), 'UND_ERR_BODY_TIMEOUT');
  });
  await check('abort through TLS proxy', async () => {
    configure(0, { HTTPS_PROXY: proxyUrl }); const controller = new AbortController();
    const reader = (await fetch(tlsOrigin + '/stall?id=tls-abort', { signal: controller.signal })).body.getReader();
    await reader.read(); controller.abort(); await assert.rejects(reader.read(), { name: 'AbortError' });
    await waitClosed('tls-abort');
  });
  await check('requests still work after timeout and abort', async () => {
    // Retain the same dispatcher from the previous aborted proxy request.
    assert.deepEqual(await (await fetch(tlsOrigin)).json(), { ok: true });
  });
} finally {
  dispatcherApi.setGlobalDispatcher(savedDispatcher);
  for (const timer of timers) clearTimeout(timer);
  for (const socket of sockets) socket.destroy();
  await check('dispatcher destruction settles', () => Promise.all([...dispatchers].map((dispatcher) => dispatcher.destroy())));
  await check('server cleanup settles', () => Promise.all(servers.map((server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }))));
}
report.passed = checks.filter((check) => check.passed).length;
report.failed = checks.filter((check) => !check.passed).length;
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
