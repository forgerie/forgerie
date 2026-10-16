#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 -c node
// Run against scripts/fast-chat-open-server.mjs, never a live profile.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { CDP, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
const url = process.argv[2] ?? "http://127.0.0.1:18673/";
const output = process.argv[3] ?? "/tmp/connection-health-acceptance";
const session = `connection-health-${process.pid}`;
const browser = (...args) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 30_000 });
const result = { sockets: 0, opens: 0, pongs: 0, errors: [], switches: 0, wakeEvents: 0 };
let cdp;
try {
  browser("open", url);
  const port = new URL(browser("get", "cdp-url").trim()).port;
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  cdp = await CDP.connect(pages.find(page => page.type === "page" && page.url.startsWith(url)).webSocketDebuggerUrl);
  await cdp.send("Network.enable"); await cdp.send("Runtime.enable");
  cdp.listeners.set("Network.webSocketCreated", [() => { result.sockets++; }]);
  cdp.listeners.set("Network.webSocketFrameReceived", [event => {
    const frame = event.response;
    const text = frame.opcode === 2 ? Buffer.from(frame.payloadData, "base64").toString() : frame.payloadData;
    if (text.includes('"connection.pong"')) result.pongs++;
  }]);
  cdp.listeners.set("Network.requestWillBeSent", [event => { if (new URL(event.request.url).pathname.endsWith("/open")) result.opens++; }]);
  cdp.listeners.set("Runtime.exceptionThrown", [event => result.errors.push(event.exceptionDetails.text)]);
  const until = async expression => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(30); }
    throw new Error(`Timed out: ${expression}`);
  };
  await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' }, configurable: true });` });
  await cdp.send("Page.reload", { ignoreCache: true });
  await until("!!document.getElementById('picker-row-small')");
  async function select(id) {
    await evaluate(cdp, `document.getElementById('picker-row-${id}').click()`);
    await until(`[...document.querySelectorAll('.session-title')].some(el => el.getBoundingClientRect().width > 0 && el.textContent === 'Baseline ${id}') && [...document.querySelectorAll('[data-composer-input]')].some(el => el.getBoundingClientRect().width > 0 && el.getAttribute('contenteditable') === 'true')`);
    result.switches++;
  }
  await select("small"); await select("large");
  await sleep(100);
  const baseline = { sockets: result.sockets, opens: result.opens };
  await evaluate(cdp, `(() => {
    window.__unexpectedReconnects = 0;
    new MutationObserver(() => {
      if ([...document.querySelectorAll('.status-chip-label')].some(el => el.textContent === 'Reconnecting')) window.__unexpectedReconnects++;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  })()`);
  for (let index = 0; index < 8; index++) {
    await select(index % 2 ? "large" : "small");
    await evaluate(cdp, `(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      delete document.visibilityState;
    })()`);
    result.wakeEvents += 3;
    await sleep(60);
  }
  result.healthyNewSockets = result.sockets - baseline.sockets;
  result.healthyOpenReads = result.opens - baseline.opens;
  assert.equal(result.healthyNewSockets, 0, "healthy returns must not create sockets");
  assert.equal(result.healthyOpenReads, 0, "healthy returns must not re-read transcripts");
  assert.ok(result.pongs >= 3, "the production daemon routes must answer actual probes");
  result.unexpectedReconnects = await evaluate(cdp, "window.__unexpectedReconnects");
  assert.equal(result.unexpectedReconnects, 0);
  assert.deepEqual(result.errors, []);
  await evaluate(cdp, `(() => {
    const input = [...document.querySelectorAll('[data-composer-input]')].find(el => el.getBoundingClientRect().width > 0);
    input.dataset.recoveryProof = 'same-editor'; input.focus();
  })()`);
  await cdp.send("Input.insertText", { text: "Unsent draft survives a real drop" });
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await evaluate(cdp, "document.dispatchEvent(new Event('visibilitychange'))");
  await until("[...document.querySelectorAll('.status-chip-label')].some(el => el.getBoundingClientRect().width > 0 && el.textContent === 'Reconnecting')");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await evaluate(cdp, "window.dispatchEvent(new Event('online'))");
  await until("[...document.querySelectorAll('.status-chip-label')].some(el => el.getBoundingClientRect().width > 0 && el.textContent === 'Connected')");
  result.realDropRecoveredWithDraft = await evaluate(cdp, `!![...document.querySelectorAll('[data-composer-input][data-recovery-proof]')].find(el => el.getBoundingClientRect().width > 0 && el.textContent.includes('Unsent draft survives a real drop'))`);
  assert.equal(result.realDropRecoveredWithDraft, true);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${output}.png`, Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await writeFile(`${output}.json`, JSON.stringify(result, null, 2));
  cdp?.close(); browser("close");
}
