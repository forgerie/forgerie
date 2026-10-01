#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Exercises the real presentation using a separate fixture entry point, not API interception.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { hitRect } from "./lib/hit.mjs";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const profile = await mkdtemp(join(tmpdir(), "aui-visual-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(chromeBin, "Chromium is required");
const chrome = launchChrome(chromeBin, port, profile);
const url = new URL("/verification/preview.html", process.env.APP_URL ?? "http://127.0.0.1:8510/");
const result = { postures: [], states: [], errors: [], apiRequests: [] };
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [(event) => {
    if (new URL(event.request.url).pathname.startsWith("/api/")) result.apiRequests.push(event.request.url);
  }]);
  async function until(expression) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await evaluate(cdp, expression)) return;
      await sleep(30);
    }
    throw new Error(`Timed out: ${expression}`);
  }
  await cdp.send("Page.navigate", { url: url.href });
  await until(`document.querySelector('.code-body code')?.textContent.includes('useExternalStoreRuntime')`);
  await evaluate(cdp, `document.fonts.ready.then(() => true)`);
  await evaluate(cdp, `document.querySelector('textarea').focus()`);
  await cdp.send("Input.insertText", { text: "Unsent draft survives fold and rotation" });
  const extraSizes = [{ name: "keyboard-height-emulation", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }];
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of [...FOLD8_POSTURES, ...extraSizes]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await sleep(100);
      const state = await evaluate(cdp, `({
        width: innerWidth, height: innerHeight,
        draft: document.querySelector('textarea').value,
        overflow: document.documentElement.scrollWidth > innerWidth,
        send: document.querySelector('[aria-label="Send message"]').getBoundingClientRect().toJSON(),
        sendHit: (${hitRect})(document.querySelector('[aria-label="Send message"]')),
        textarea: document.querySelector('textarea').getBoundingClientRect().toJSON(),
        column: document.querySelector('.thread-column').getBoundingClientRect().width,
        bubble: document.querySelector('.user-bubble').getBoundingClientRect().width,
        theme: getComputedStyle(document.body).backgroundColor
      })`);
      assert.equal(state.draft, "Unsent draft survives fold and rotation");
      assert.equal(state.overflow, false);
      assert.equal(state.width, posture.width);
      assert.ok(state.sendHit.width >= 44 && state.sendHit.height >= 44);
      assert.ok(state.send.x >= 0 && state.send.right <= state.width && state.send.y >= 0 && state.send.bottom <= state.height);
      assert.ok(state.textarea.y >= 0 && state.textarea.bottom <= state.height);
      assert.ok(state.bubble <= state.column * 0.8 + 1);
      result.postures.push({ scheme, posture: posture.name, ...state });
    }
  }
  // Real click and keyboard send, but the fixture cannot call Pi.
  await evaluate(cdp, `document.querySelector('[aria-label="Send message"]').click()`);
  await until(`document.querySelectorAll('.message').length === 4 && document.querySelector('textarea').value === ''`);
  await evaluate(cdp, `document.querySelector('textarea').focus()`);
  await cdp.send("Input.insertText", { text: "Keyboard send" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(`document.querySelectorAll('.message').length === 6 && document.querySelector('textarea').value === ''`);
  result.sendClickAndEnter = true;
  const olderCopyActions = await evaluate(cdp, `[...document.querySelectorAll('.message-actions')].map(element => ({
    visibility: getComputedStyle(element).visibility,
    display: getComputedStyle(element).display,
    target: Math.min((${hitRect})(element.querySelector('button')).width, (${hitRect})(element.querySelector('button')).height)
  }))`);
  assert.equal(olderCopyActions.length, 3);
  assert.ok(olderCopyActions.every(action => action.visibility === 'visible' && action.display !== 'none' && action.target >= 44));
  result.olderResponsesRemainCopyable = true;
  for (const scenario of ["empty", "loading", "running", "disconnected", "reconnecting", "reconnecting-running"]) {
    url.searchParams.set("scenario", scenario);
    await cdp.send("Page.navigate", { url: url.href });
    await until(`document.querySelector('.connection-status') !== null`);
    await sleep(100);
    const state = await evaluate(cdp, `({
      status: document.querySelector('.connection-status').textContent,
      welcome: !!document.querySelector('.thread-welcome'),
      loading: !!document.querySelector('[aria-label="Loading conversation"]'),
      disabled: document.querySelector('textarea').disabled,
      stop: !!document.querySelector('[aria-label="Stop generating"]'),
      stopDisabled: document.querySelector('[aria-label="Stop generating"]')?.disabled,
      sendDisabled: document.querySelector('[aria-label="Send message"]')?.disabled,
      alert: document.querySelector('[role="alert"]')?.textContent
    })`);
    if (scenario === "empty") assert.equal(state.welcome, true);
    if (scenario === "loading") { assert.equal(state.loading, true); assert.equal(state.welcome, false); assert.equal(state.disabled, true); }
    if (scenario === "disconnected") { assert.equal(state.disabled, true); assert.ok(state.alert.includes("Reload")); }
    if (scenario.startsWith("reconnecting")) {
      assert.equal(state.disabled, true);
      assert.equal(state.status, "Reconnecting");
      assert.ok(state.alert.includes("automatically"));
      assert.equal(scenario === "reconnecting" ? state.sendDisabled : state.stopDisabled, true);
    }
    if (scenario === "running") {
      assert.equal(state.stop, true);
      await evaluate(cdp, `document.querySelector('[aria-label="Stop generating"]').click()`);
      await until(`!!document.querySelector('[aria-label="Send message"]')`);
    }
    result.states.push({ scenario, ...state });
  }
  url.searchParams.set("scenario", "stress");
  await cdp.send("Page.navigate", { url: url.href });
  await until(`document.querySelector('.table-scroll') !== null`);
  const stress = await evaluate(cdp, `({
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
    codeScrolls: document.querySelector('.code-body').scrollWidth > document.querySelector('.code-body').clientWidth,
    tableScrolls: document.querySelector('.table-scroll').scrollWidth > document.querySelector('.table-scroll').clientWidth,
    codeKeyboardAccessible: document.querySelector('.code-body').tabIndex === 0,
    tableKeyboardAccessible: document.querySelector('.table-scroll').tabIndex === 0
  })`);
  assert.equal(stress.pageOverflow, false);
  assert.equal(stress.codeScrolls, true);
  assert.equal(stress.tableScrolls, true);
  assert.equal(stress.codeKeyboardAccessible, true);
  assert.equal(stress.tableKeyboardAccessible, true);
  result.longContent = stress;
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.apiRequests, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "visual-acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
