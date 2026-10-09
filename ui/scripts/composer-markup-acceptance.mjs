#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Lists and quotes in the composer draw as the transcript draws them, with real
// Chromium key input against the network-free fixture, at every Fold posture in both themes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage, pressCombo } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const output = resolve(process.env.SHOT_DIR ?? "verification/local/composer-markup");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "forgerie-markup-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const result = { combinations: [], errors: [], apiRequests: [] };
const INPUT = "document.querySelector('[data-composer-input]')";
const DRAFT = [
  "Plan for today:",
  "- fix the composer so a long item wraps under its own text, not under the bullet",
  "- write the tests",
  "  - unit",
  "  - browser",
  "",
  "1. first",
  "2. second",
  "",
  "> a quoted line that runs long enough to wrap across the folded screen",
  "> > a nested quote",
].join("\n");
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (new URL(event.request.url).pathname.startsWith("/api/")) result.apiRequests.push(event.request.url); }]);
  async function until(expression) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(40); }
    throw new Error(`Timed out: ${expression}`);
  }
  const draft = () => evaluate(cdp, `${INPUT}.value`);
  const insert = (text) => cdp.send("Input.insertText", { text });
  async function clear() {
    await evaluate(cdp, `${INPUT}.focus()`);
    await pressCombo(cdp, "ctrl+a"); await pressCombo(cdp, "backspace");
    assert.equal(await draft(), "");
  }
  for (const scheme of ["dark", "light"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of [...FOLD8_POSTURES, { name: "narrow-pane", width: 280, height: 500 }]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html` });
      await until(`!!${INPUT}`);
      await clear();
      // Wait for the Markdown commands, as a person types after the bar draws.
      for (let tries = 0; ; tries++) {
        await insert("- a"); await pressCombo(cdp, "enter");
        if (await draft() === "- a\n- ") break;
        assert.ok(tries < 100, "the Markdown commands did not load"); await clear(); await sleep(150);
      }
      await clear();
      await insert(DRAFT);
      assert.equal(await draft(), DRAFT);
      await until("document.querySelectorAll('.cm-md-marker').length === 6");
      const reading = await evaluate(cdp, `(() => {
        const lines = [...${INPUT}.querySelectorAll('.cm-line')];
        const markers = [...document.querySelectorAll('.cm-md-marker')].map((node) => node.textContent);
        const shown = lines.map((line) => line.textContent);
        // A wrapped item's second visual line starts where its text starts, not under the bullet.
        const item = lines.find((line) => line.textContent.includes('fix the composer'));
        const text = [...item.childNodes].find((node) => node.nodeType === 3);
        const range = document.createRange(); range.selectNodeContents(text);
        const rects = [...range.getClientRects()];
        const quote = lines.find((line) => line.textContent.includes('quoted line'));
        return { markers, shown, wraps: rects.length, lefts: rects.map((rect) => Math.round(rect.left)),
          quoteColor: getComputedStyle(quote).color, pageOverflow: document.documentElement.scrollWidth > innerWidth };
      })()`);
      assert.deepEqual(reading.markers, ["•", "•", "◦", "◦", "1.", "2."]);
      for (const line of reading.shown) assert.ok(!/^\s*(?:[-*+] |\d+\. |>)/u.test(line), `markup still shows: ${line}`);
      if (reading.wraps > 1) assert.ok(reading.lefts.every((left) => Math.abs(left - reading.lefts[0]) <= 1), JSON.stringify(reading.lefts));
      assert.equal(reading.pageOverflow, false);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(output, `${scheme}-${posture.name}.png`), Buffer.from(data, "base64"));
      await evaluate(cdp, `${INPUT}.closest('.cm-scroller').scrollTop = 0`); await sleep(100);
      const top = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(output, `${scheme}-${posture.name}-top.png`), Buffer.from(top.data, "base64"));
      // The caret steps over a hidden marker, and Backspace at an item's text removes the marker.
      await clear(); await insert("- hi"); await pressCombo(cdp, "home"); await insert("x");
      assert.equal(await draft(), "- xhi");
      // A press left of the bullet lands where the text starts, too.
      await clear(); await insert("- hi");
      const press = await evaluate(cdp, `(() => { const box = ${INPUT}.querySelector('.cm-md-item').getBoundingClientRect(); return { x: box.left + 2, y: box.top + box.height / 2 }; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, ...press, button: "left", clickCount: 1 });
      await insert("y"); assert.equal(await draft(), "- yhi");
      await clear(); await insert("- hi"); await pressCombo(cdp, "enter"); await pressCombo(cdp, "tab");
      assert.equal(await draft(), "- hi\n  - ");
      await until("document.querySelectorAll('.cm-md-marker').length === 2");
      await pressCombo(cdp, "backspace"); assert.equal(await draft(), "- hi\n- ");
      await pressCombo(cdp, "backspace"); assert.equal(await draft(), "- hi\n");
      await clear(); await insert("> q"); await pressCombo(cdp, "enter"); assert.equal(await draft(), "> q\n> ");
      await pressCombo(cdp, "backspace"); assert.equal(await draft(), "> q\n");
      result.combinations.push({ scheme, posture: posture.name, wraps: reading.wraps, home: true, press: true, backspace: true });
    }
  }
  assert.deepEqual(result.errors, []); assert.deepEqual(result.apiRequests, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.combinations));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
