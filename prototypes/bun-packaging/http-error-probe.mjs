#!/usr/bin/env nix-shell
/*
#! nix-shell -i node -p nodejs_24
*/
// Minimise pending-body errors without Forgerie, Vitest or a custom client factory.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { undici } from './http-adapter.mjs';

const results = [];
async function rejects(name, action, expected) {
  let timer;
  const began = performance.now();
  try {
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error('Promise did not settle within 3000ms')); }, 3000); });
    const error = await Promise.race([action().then(() => { throw new Error('Expected rejection, got fulfilment'); }, (error) => error), deadline]);
    assert.equal(expected(error), true, String(error));
    results.push({ name, passed: true, error: { name: error.name, message: error.message, causeCode: error.cause?.code }, elapsedMs: performance.now() - began });
  } catch (error) { results.push({ name, passed: false, error: { name: error.name, message: error.message }, elapsedMs: performance.now() - began }); }
  finally { clearTimeout(timer); }
}
for (const type of [undefined, 'bytes']) await rejects(`ReadableStream ${type ?? 'default'} error rejects pending read`, () => {
  let controller;
  const stream = new ReadableStream({ type, start(value) { controller = value; } });
  const pending = stream.getReader().read();
  queueMicrotask(() => { controller.error(new Error('fixture-stream-error')); });
  return pending;
}, (error) => error.message === 'fixture-stream-error');

const serverTimers = new Set();
const server = http.createServer((_, response) => {
  response.write('first;');
  const timer = setTimeout(() => { serverTimers.delete(timer); if (!response.destroyed) response.end('second'); }, 1500);
  serverTimers.add(timer);
});
const agent = new undici.Agent({ bodyTimeout: 300, headersTimeout: 300 });
agent.on('error', () => {});
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  await rejects('npm undici default Agent body timeout rejects text', async () => {
    const response = await undici.fetch(url, { dispatcher: agent });
    return response.text();
  }, (error) => error.cause?.code === 'UND_ERR_BODY_TIMEOUT');
  await rejects('npm undici default Agent abort rejects pending read', async () => {
    const controller = new AbortController();
    const response = await undici.fetch(url, { dispatcher: agent, signal: controller.signal });
    const reader = response.body.getReader(); await reader.read();
    const pending = reader.read(); controller.abort(); return pending;
  }, (error) => error.name === 'AbortError');
} finally {
  for (const timer of serverTimers) clearTimeout(timer);
  server.closeAllConnections(); await agent.destroy();
  await new Promise((resolve) => { server.close(resolve); });
}
console.log(JSON.stringify({ node: process.versions.node, bun: process.versions.bun ?? null, results }, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
