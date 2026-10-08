#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Read-only real-client recovery. CDP takes the browser offline; no API request
// interception, prompts, daemon restarts, or production writes are involved.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const id = process.env.SESSION_ID;
assert.ok(id, "SESSION_ID must name an existing idle session");
const url = new URL(process.env.APP_URL ?? "http://127.0.0.1:8510/");
url.searchParams.set("session", id);
const profile = await mkdtemp(join(tmpdir(), "aui-reconnect-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(chromeBin, "Chromium is required");
const chrome = launchChrome(chromeBin, port, profile);
const result = { connections: 0, historyRequests: 0, mutations: [], errors: [], postures: [] };
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  cdp.listeners.set("Network.webSocketCreated", [(event) => { if (event.url.includes("/events")) result.connections++; }]);
  cdp.listeners.set("Network.requestWillBeSent", [(event) => {
    const path = new URL(event.request.url).pathname;
    if (path.endsWith("/messages")) result.historyRequests++;
    if (event.request.method === "POST" && path.startsWith("/api/")) result.mutations.push(path);
  }]);
  const read = () => evaluate(cdp, `({
    status: document.querySelector('.connection-status')?.textContent,
    alert: document.querySelector('[role=alert]')?.textContent,
    draft: document.querySelector('[data-composer-input]')?.value,
    sameInput: !!document.querySelector('[data-composer-input][data-recovery-proof]'),
    disabled: document.querySelector('[data-composer-input]')?.disabled,
    sendDisabled: document.querySelector('[aria-label="Send message"]')?.disabled,
    messageCount: document.querySelectorAll('.message').length,
    history: [...document.querySelectorAll('.message-text')].map(e => e.textContent).join('\\n'),
    sameDisclosure: !!document.querySelector('details[data-recovery-proof][open]'),
    scroll: document.querySelector('.transcript')?.scrollTop,
    width: innerWidth, height: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
    send: document.querySelector('[aria-label="Send message"]')?.getBoundingClientRect().toJSON()
  })`);
  async function until(predicate) {
    const deadline = Date.now() + 20_000;
    let state;
    while (Date.now() < deadline) {
      state = await read();
      if (predicate(state)) return state;
      await sleep(30);
    }
    throw new Error(`Recovery state timed out: ${JSON.stringify({ status: state?.status, alert: state?.alert })}`);
  }
  await cdp.send("Page.navigate", { url: url.href });
  await until((state) => state.status === "Connected" && state.messageCount > 0);
  await evaluate(cdp, `document.fonts.ready.then(() => true)`);
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-composer-input]');
    input.dataset.recoveryProof = 'draft';
    input.focus();
    const details = document.querySelector('.message-assistant details');
    if (details) { details.dataset.recoveryProof = 'disclosure'; details.open = true; }
  })()`);
  await cdp.send("Input.insertText", { text: "Unsent draft survives reconnect" });
  await sleep(100);
  await evaluate(cdp, `document.querySelector('.transcript').scrollTop = 80`);
  const baseline = await read();
  assert.equal(baseline.draft, "Unsent draft survives reconnect");
  for (const posture of FOLD8_POSTURES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // Simulates returning from sleep. This closes even a half-open socket and
    // performs a new join through the shipped visibility listener.
    await evaluate(cdp, `document.dispatchEvent(new Event('visibilitychange'))`);
    let state = await until((value) => value.status === "Reconnecting" && value.disabled);
    assert.equal(state.sameInput, true);
    assert.equal(state.draft, baseline.draft);
    assert.equal(state.history, baseline.history);
    assert.equal(state.sendDisabled, true);
    assert.ok(state.alert.includes("automatically"));
    if (baseline.sameDisclosure) assert.equal(state.sameDisclosure, true);
    // Stay offline long enough to observe an unsuccessful attempt and retry.
    const socketsAtDrop = result.connections;
    await sleep(900);
    state = await read();
    assert.equal(state.status, "Reconnecting");
    assert.ok(result.connections > socketsAtDrop, "Expected an automatic retry while offline");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // First recovery proves the timer works without an online signal. Later
    // recoveries prove an online signal expedites retry rather than reloading.
    if (result.postures.length > 0) await evaluate(cdp, `window.dispatchEvent(new Event('online'))`);
    state = await until((value) => value.status === "Connected" && !value.disabled);
    assert.equal(state.sameInput, true);
    assert.equal(state.draft, baseline.draft);
    assert.equal(state.messageCount, baseline.messageCount);
    assert.equal(state.history, baseline.history);
    assert.equal(state.alert, undefined);
    assert.equal(state.sendDisabled, false);
    assert.equal(state.overflow, false);
    assert.equal(state.width, posture.width);
    assert.ok(state.send && state.send.x >= 0 && state.send.right <= state.width && state.send.bottom <= state.height);
    if (baseline.sameDisclosure) assert.equal(state.sameDisclosure, true);
    result.postures.push({ posture: posture.name, draftPreserved: true, transcriptPreserved: true, disclosurePreserved: state.sameDisclosure, send: state.send });
  }
  assert.deepEqual(result.mutations, []);
  assert.deepEqual(result.errors, []);
  assert.ok(result.historyRequests >= 5, "Every restored connection must refetch history");
  result.messageCount = baseline.messageCount;
  result.scrollAfterRecovery = (await read()).scroll;
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "reconnect-acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
