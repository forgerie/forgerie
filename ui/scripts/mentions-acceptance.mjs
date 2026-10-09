#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Real input on a configured, network-free source. Read-only live discovery is optional.
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
const profile = await mkdtemp(join(tmpdir(), "aui-mentions-"));
const port = await getFreePort();
const bin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(bin, "Chromium is required");
const chrome = launchChrome(bin, port, profile);
const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const report = { cases: [], apiRequests: [], errors: [], live: undefined };
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => report.errors.push(event.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [(event) => {
    if (new URL(event.request.url).pathname.startsWith("/api/")) report.apiRequests.push({ url: event.request.url, method: event.request.method });
  }]);
  async function until(expression) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(30); }
    throw new Error(`Timed out: ${expression}`);
  }
  async function draft(text) {
    await evaluate(cdp, `document.querySelector('[aria-label="Message"]').focus()`);
    await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
    await sleep(180);
  }
  const page = (scenario) => new URL(`/verification/preview.html?scenario=${scenario}`, base).href;
  await cdp.send("Page.navigate", { url: page("mentions") });
  await until(`!!document.querySelector('[aria-label="Message"]')`);
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of [...FOLD8_POSTURES, { name: "keyboard-height", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      for (const text of ["@src", "#model"]) {
        await draft(text);
        await until(`document.querySelectorAll('.option-row').length > 0`);
        const state = await evaluate(cdp, `(() => {
          const box = (node) => node.getBoundingClientRect().toJSON();
          return { popup: box(document.querySelector('.floating-panel')), input: box(document.querySelector('[aria-label="Message"]')),
            overflow: document.documentElement.scrollWidth > innerWidth, draft: document.querySelector('[aria-label="Message"]').value,
            target: box(document.querySelector('.option-row')), parent: document.querySelector('[role=listbox]').parentElement.tagName };
        })()`);
        assert.equal(state.draft, text);
        assert.equal(state.overflow, false);
        assert.equal(state.parent, "BODY", "Popover must escape the transcript scroll container");
        assert.ok(state.popup.x >= 0 && state.popup.right <= posture.width + 1 && state.popup.y >= 0 && state.popup.bottom <= posture.height + 1,
          `${scheme}/${posture.name}/${text} popup is off-screen: ${JSON.stringify(state.popup)}`);
        assert.ok(state.input.bottom <= posture.height + 1);
        assert.ok(state.target.height >= 44);
        // Navigating to the last result must bring it into view in the short pane.
        const count = await evaluate(cdp, `document.querySelectorAll('.option-row').length`);
        for (let i = 1; i < count; i++) await pressCombo(cdp, "arrowdown");
        const visible = await evaluate(cdp, `(() => {
          const list = document.querySelector('.floating-panel').getBoundingClientRect();
          const item = document.getElementById(document.querySelector('[aria-label="Message"]').getAttribute('aria-activedescendant')).getBoundingClientRect();
          return item.y >= list.y && item.bottom <= list.bottom + 1;
        })()`);
        assert.equal(visible, true, "Keyboard-selected result stays visible");
        await pressCombo(cdp, "escape");
        assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), text);
        report.cases.push({ scheme, posture: posture.name, trigger: text[0], ...state });
      }
    }
  }
  await draft("read @src");
  await pressCombo(cdp, "arrowdown"); await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), 'read @"src/file with spaces.ts" ');
  assert.equal(await evaluate(cdp, `document.querySelectorAll('.message').length`), 2, "Selection must not send a chat message");
  await draft("#model"); await pressCombo(cdp, "tab");
  assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), "#provider/model-0 ");
  await draft("/name");
  await until(`document.querySelectorAll('.command-option').length === 1`);
  await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), "/name ");
  await draft("/review @src");
  await until(`document.querySelectorAll('.option-row').length > 0`);
  await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), "/review @src/main.ts ");
  assert.equal(await evaluate(cdp, `document.querySelectorAll('.message').length`), 2, "Mention and slash completion must coexist without sending");
  await draft("@missing");
  assert.ok(await evaluate(cdp, `document.body.textContent.includes('No matching files.')`));
  await draft("@error");
  assert.ok(await evaluate(cdp, `document.querySelector('[role="alert"]')?.textContent.includes('File suggestions unavailable')`));
  await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, `document.querySelectorAll('.message').length`), 2);
  await cdp.send("Page.navigate", { url: page("mentions-ask") });
  await until(`!!document.querySelector('.ask-question')`);
  await draft("@src"); await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-composer-input]').length`), 1);
  assert.ok(await evaluate(cdp, `document.querySelector('.ask-question').textContent.startsWith('Where should')`));
  assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), "@src/main.ts ");
  await pressCombo(cdp, "enter");
  assert.ok(await evaluate(cdp, `document.querySelector('.ask-question').textContent.startsWith('Which checks')`));
  await cdp.send("Page.navigate", { url: page("mentions-prefs") });
  await until(`!!document.querySelector('[aria-label="Message"]')`);
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of FOLD8_POSTURES) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await draft("#");
      await until(`document.querySelectorAll('.option-row').length === 3`);
      const labels = await evaluate(cdp, `[...document.querySelectorAll('.option-row-name')].map(node => node.textContent)`);
      assert.deepEqual(labels, ["Careful model", "Fast model", "Balanced model"], "Only shown models, with favorites in Settings order");
      // The Thinking row stays on screen and inside the panel at every posture.
      const row = await evaluate(cdp, `(() => { const r = document.querySelector('.mention-thinking')?.getBoundingClientRect(); const p = document.querySelector('.floating-panel').getBoundingClientRect();
        return r && { inside: r.top >= p.top - 1 && r.bottom <= p.bottom + 1, pressed: document.querySelector('.mention-thinking [aria-pressed=true]').textContent }; })()`);
      assert.deepEqual(row, { inside: true, pressed: "High" }, "The favorite's saved level is pressed in a visible Thinking row");
      // A favorite saved with a level inserts it.
      await pressCombo(cdp, "tab");
      assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), "#provider/careful:high ");
      // Typing a colon lists the highlighted model's levels; the label a person reads filters them too.
      await draft("#fa");
      await until(`document.querySelector('.option-row-name')?.textContent === 'Fast model'`);
      await cdp.send("Input.insertText", { text: ":ext" });
      await until(`document.querySelector('.option-list-heading')?.textContent === 'Thinking for Fast model'`);
      assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('.option-row-name')].map(node => node.textContent)`), ["Extra high"]);
      await pressCombo(cdp, "enter");
      assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), "#provider/fast:xhigh ");
      await draft("#hidden");
      await until(`document.body.textContent.includes('No matching models.')`);
      assert.equal(await evaluate(cdp, `document.querySelectorAll('.option-row').length`), 0);
      await pressCombo(cdp, "escape");
      report.cases.push({ scheme, posture: posture.name, preferences: true, labels });
    }
  }
  assert.equal(report.apiRequests.length, 0, "Preview must not make API requests");

  if (process.env.SESSION_ID) {
    const live = new URL(base); live.searchParams.set("session", process.env.SESSION_ID);
    await cdp.send("Page.navigate", { url: live.href });
    await until(`!!document.querySelector('[aria-label="Message"]') && !document.querySelector('[aria-label="Message"]').disabled`);
    await draft("@src");
    await until(`document.querySelectorAll('.option-row').length > 0`);
    const file = await evaluate(cdp, `document.querySelector('.option-row-name').textContent`);
    await pressCombo(cdp, "escape");
    await draft("#");
    await until(`document.querySelectorAll('.option-row').length > 0`);
    const model = await evaluate(cdp, `document.querySelector('.option-row-name').textContent`);
    await pressCombo(cdp, "enter");
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`), `#${model} `);
    assert.ok(report.apiRequests.every((r) => r.method === "GET"), "Read-only validation must not mutate the session");
    report.live = { file, model, requests: report.apiRequests };
  }
  assert.deepEqual(report.errors, []);
  await mkdir("verification/local", { recursive: true });
  await writeFile("verification/local/mentions-acceptance.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors, live: report.live ?? false }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(150); if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
