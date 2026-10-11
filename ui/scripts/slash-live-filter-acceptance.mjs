#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Exercise native IME edits. Whole-value replacements bypass composition.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort, launchChrome, waitForDebugger, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
import { openPosturePage, pressCombo } from "../../scripts/lib/posture-page.mjs";
import { FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";
const origin = process.env.APP_URL ?? "http://127.0.0.1:8527";
const profile = await mkdtemp(join(tmpdir(), "slash-live-filter-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN ?? spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin, "Chromium must be available");
const chrome = launchChrome(chromeBin, port, profile);
const errors = [];
const output = process.env.SHOTS_DIR;
if (output) await mkdir(output, { recursive: true });
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails)]);
  const selector = '[data-composer-input]';
  async function until(expression) {
    for (let attempt = 0; attempt < 200; attempt++) {
      assert.deepEqual(errors, [], "browser exceptions");
      if (await evaluate(cdp, expression)) return;
      await sleep(25);
    }
    throw new Error(`Timed out: ${expression}`);
  }
  const rows = () => evaluate(cdp, "[...document.querySelectorAll('[role=option]')].map(row => row.textContent)");
  for (const scenario of ["slash", "new-session"]) {
    await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=${scenario}` });
    await until(`!!document.querySelector('${selector}')`);
    // Allow the fixture catalogue and lazy editor language to settle before input.
    await sleep(300);
    const inputSelector = scenario === "new-session" ? `.ns-dialog ${selector}` : selector;
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const posture of FOLD8_POSTURES) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
        await evaluate(cdp, `document.querySelector('${inputSelector}').focus()`);
        await pressCombo(cdp, "ctrl+a");
        await cdp.send("Input.insertText", { text: "/" });
        await until(`document.querySelectorAll('[role=option]').length === ${scenario === "slash" ? 26 : 2}`);
        for (const text of ["r", "re", "rez", "re"]) {
          await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
          await until(`document.querySelector('${inputSelector}').value === '/${text}'`);
          const count = text === "rez" ? 0 : scenario === "new-session" ? 1 : text === "r" ? 22 : 2;
          await until(`document.querySelectorAll('[role=option]').length === ${count}`);
          if (text === "re") assert.deepEqual(await rows(), scenario === "slash"
            ? ["/reloadReload Pi runtime resources for this session", "/reviewReview the current changes"]
            : ["/reviewReview the current changes"]);
        }
        // A keyboard's composing Enter must not complete or send the draft.
        await evaluate(cdp, `document.querySelector('${inputSelector}').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))`);
        assert.equal(await evaluate(cdp, `document.querySelector('${inputSelector}').value`), "/re");
        if (output) {
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          await writeFile(join(output, `${scenario}-${scheme}-${posture.name}.png`), Buffer.from(data, "base64"));
        }
        await cdp.send("Input.insertText", { text: "re" });
        await sleep(100);
        if (scenario === "slash") await pressCombo(cdp, "arrowdown");
        await pressCombo(cdp, "enter");
        await until(`document.querySelector('${inputSelector}').value === '/review '`);
        console.log(`PASS: ${scenario}, ${scheme}, ${posture.name}: live composition filtering and completion`);
      }
    }
  }
  assert.deepEqual(errors, []);
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
