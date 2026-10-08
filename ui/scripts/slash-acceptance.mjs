#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Real composer interaction on deterministic fixtures; optional read-only Pi /session smoke.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage, pressCombo } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const origin = process.env.APP_URL ?? "http://127.0.0.1:8521";
const output = resolve("verification/local/slash");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-slash-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const result = { postures: [], errors: [], live: false };
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  async function until(expression) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await evaluate(cdp, expression)) return;
      await sleep(30);
    }
    const state = await evaluate(cdp, `({ draft: document.querySelector('[data-composer-input]')?.value, options: [...document.querySelectorAll('[role=option]')].map(item => item.textContent) })`);
    throw new Error(`Timed out: ${expression}: ${JSON.stringify(state)}`);
  }
  async function input(text) {
    await evaluate(cdp, "document.querySelector('[data-composer-input]').focus()");
    await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
  }
  await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=slash` });
  await until("!!document.querySelector('[data-composer-input]')");
  await input("/");
  await until("document.querySelectorAll('[role=option]').length === 26");
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of [...FOLD8_POSTURES, { name: "keyboard-budget", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await sleep(100);
      const state = await evaluate(cdp, `({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
        popup: document.querySelector('.command-popover').getBoundingClientRect().toJSON(),
        input: document.querySelector('[data-composer-input]').getBoundingClientRect().toJSON(), draft: document.querySelector('[data-composer-input]').value,
        scrollable: document.querySelector('.command-popover').scrollHeight > document.querySelector('.command-popover').clientHeight })`);
      assert.equal(state.overflow, false);
      assert.equal(state.draft, "/");
      assert.equal(state.scrollable, true);
      assert.ok(state.popup.width > 0 && state.popup.height > 0);
      assert.ok(state.popup.left >= 0 && state.popup.right <= posture.width && state.popup.top >= 0 && state.popup.bottom <= posture.height);
      assert.ok(state.input.top >= 0 && state.input.bottom <= posture.height);
      result.postures.push({ scheme, posture: posture.name, ...state });
    }
  }
  for (let index = 0; index < 25; index++) await pressCombo(cdp, "arrowdown");
  await sleep(100);
  const highlighted = await evaluate(cdp, `({ list: document.querySelector('.command-popover').getBoundingClientRect().toJSON(), item: document.querySelector('[data-highlighted]').getBoundingClientRect().toJSON() })`);
  assert.ok(highlighted.item.top >= highlighted.list.top - 1 && highlighted.item.bottom <= highlighted.list.bottom + 1);
  result.keyboardScroll = true;
  await input("/re");
  await until("document.querySelectorAll('[role=option]').length === 3");
  await pressCombo(cdp, "arrowdown");
  await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, "document.querySelector('[data-composer-input]').value"), "/review ");
  assert.equal(await evaluate(cdp, "document.querySelectorAll('.message').length"), 2);
  await input("/review src/commands.ts");
  await pressCombo(cdp, "enter");
  await until("document.querySelectorAll('.message').length === 4");
  result.keyboardCompletionAndConfirmation = true;

  await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=slash-ask` });
  await until("!!document.querySelector('.ask-question')");
  await input("/name");
  await until("document.querySelectorAll('[role=option]').length === 1");
  await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, "document.querySelector('[data-composer-input]').value"), "/name ");
  assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-composer-input]').length"), 1);
  assert.equal(await evaluate(cdp, "!!document.querySelector('.ask-question')"), true);
  await input("/name new name");
  await pressCombo(cdp, "enter");
  await until("!document.querySelector('.ask-question')");
  result.askKeyboardPrecedence = true;

  if (process.env.LIVE_SESSION) {
    await cdp.send("Network.enable");
    const mutations = [];
    cdp.listeners.set("Network.requestWillBeSent", [(event) => {
      if (event.request.method === "POST") mutations.push({ url: event.request.url, body: event.request.postData });
    }]);
    await cdp.send("Page.navigate", { url: `${origin}/?${new URLSearchParams({ session: process.env.LIVE_SESSION })}` });
    await until("document.querySelector('.connection-status')?.textContent === 'Connected'");
    await input("/session ");
    await pressCombo(cdp, "enter");
    await until("!!document.querySelector('.command-result-body [role=status]')");
    assert.equal(mutations.filter((request) => request.url.endsWith("/commands/run")).length, 1);
    assert.equal(mutations.filter((request) => request.url.endsWith("/prompt")).length, 0);
    assert.equal(JSON.parse(mutations[0].body).text, "/session ");
    result.live = { session: process.env.LIVE_SESSION, endpoint: "/commands/run", result: await evaluate(cdp, "document.querySelector('.command-result-body').textContent") };
  }
  assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
