#!/usr/bin/env nix-shell
/*
#! nix-shell -i node -p nodejs_24
*/
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { z } from 'zod';
import { configureAgentHttpDispatcher } from '../../dist/server/sessiond/agentHttpDispatcher.js';

// Use the production configuration code and native global fetch, outside Vitest.
const saved = getGlobalDispatcher();
const gaps = new Set();
const server = http.createServer((_, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.write('first;');
  const timer = setTimeout(() => { gaps.delete(timer); response.end('second'); }, 1500);
  gaps.add(timer);
});
const report = { node: process.versions.node, bun: process.versions.bun ?? null,
  zodDirectImport: typeof z.object, undiciAgentClose: typeof new Agent().close,
  undiciResolved: import.meta.resolve('undici') };
const installedUndici = await import(new URL('../../node_modules/undici/index.js', import.meta.url).href);
const installedAgent = new installedUndici.Agent();
report.installedUndiciAgentClose = typeof installedAgent.close;
await installedAgent.close();
try {
  assert.equal(z.object({ value: z.string() }).parse({ value: 'ok' }).value, 'ok');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  configureAgentHttpDispatcher(300);
  report.configuredDispatcherClose = typeof getGlobalDispatcher().close;
  const began = performance.now();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/stall`);
  try {
    report.body = await response.text();
    report.bodyRejected = false;
  } catch (error) {
    report.bodyRejected = true;
    report.error = { name: error.name, message: error.message, causeCode: error.cause?.code };
  }
  report.elapsedMs = performance.now() - began;
  report.gatePassed = report.bodyRejected && report.error.causeCode === 'UND_ERR_BODY_TIMEOUT';
} finally {
  const installed = getGlobalDispatcher();
  setGlobalDispatcher(saved);
  if (typeof installed.close === 'function') await installed.close();
  gaps.forEach(clearTimeout);
  server.closeAllConnections();
  await new Promise((accept) => server.close(accept));
}
console.log(JSON.stringify(report, null, 2));
if (!report.gatePassed) process.exitCode = 1;
