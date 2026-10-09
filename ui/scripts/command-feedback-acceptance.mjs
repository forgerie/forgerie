#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findChrome, launchChrome, getFreePort, waitForDebugger, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
import { openPosturePage, pressCombo } from "../../scripts/lib/posture-page.mjs";
import { FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";

const origin = process.env.APP_URL ?? "http://127.0.0.1:5173";
const out = process.env.SHOT_DIR ?? "/tmp/forgerie-command-feedback";
const chromium = findChrome(); assert.ok(chromium);
const profile = await mkdtemp(join(tmpdir(), "command-feedback-"));
const port = await getFreePort();
const chrome = launchChrome(chromium, port, profile);
const result = { cases: [], errors: [], transitions: [] };
let cdp;
async function until(expression) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await evaluate(cdp, expression)) return;
    await sleep(30);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function navigate(scenario) {
  await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=${scenario}` });
  await until("!!document.querySelector('[data-composer-input]')");
}
async function input(text) {
  await evaluate(cdp, "document.querySelector('[data-composer-input]').focus()");
  await pressCombo(cdp, "ctrl+a"); await cdp.send("Input.insertText", { text });
}
async function move(x, y) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); }
try {
  await mkdir(out, { recursive: true });
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of [...FOLD8_POSTURES, { name: "narrow", width: 280, height: 500 }, { name: "keyboard", width: 475, height: 280 }]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      for (const scenario of ["command-confirmation", "command-long-confirmation", "command-details", "command-choices"]) {
        await navigate(scenario);
        const confirmation = scenario.includes("confirmation");
        await until(confirmation ? "!!document.querySelector('.toast')" : "!!document.querySelector('.command-result')");
        const before = await evaluate(cdp, `({ overflow: document.documentElement.scrollWidth > innerWidth,
          composer: document.querySelector('.composer').getBoundingClientRect().toJSON(),
          feedback: document.querySelector('${confirmation ? ".toast" : ".command-result"}').getBoundingClientRect().toJSON(),
          dismiss: document.querySelector('${confirmation ? ".toast-dismiss" : ".command-result-head button"}').getBoundingClientRect().toJSON(),
          messages: document.querySelectorAll('.message').length,
          reserved: !!document.querySelector('.command-result'), status: document.querySelector('[role=status]')?.textContent })`);
        assert.equal(before.overflow, false);
        for (const box of [before.composer, before.feedback, before.dismiss]) {
          assert.ok(box.left >= 0 && box.right <= posture.width + 1 && box.top >= 0 && box.bottom <= posture.height + 1, JSON.stringify({ scenario, posture, box }));
        }
        assert.equal(before.reserved, !confirmation);
        await evaluate(cdp, `document.querySelector('${confirmation ? ".toast-dismiss" : ".command-result-head button"}').click()`);
        await until(confirmation ? "!document.querySelector('.toast')" : "!document.querySelector('.command-result')");
        if (confirmation) {
          const after = await evaluate(cdp, "document.querySelector('.composer').getBoundingClientRect().toJSON()");
          assert.equal(after.top, before.composer.top);
          assert.equal(after.bottom, before.composer.bottom);
        }
        assert.equal(await evaluate(cdp, "document.querySelectorAll('.message').length"), before.messages);
        result.cases.push({ scheme, posture: posture.name, scenario, ...before });
      }
    }
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...FOLD8_POSTURES[2], deviceScaleFactor: 2.625, mobile: true });
  await navigate("command-confirmation");
  await input("A draft that survives rotation");
  for (const posture of FOLD8_POSTURES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await sleep(100);
    assert.equal(await evaluate(cdp, "document.querySelector('[data-composer-input]').textContent"), "A draft that survives rotation");
    assert.equal(await evaluate(cdp, "!!document.querySelector('.toast')"), true);
    result.transitions.push(posture.name);
  }
  await input("/name renamed again"); await pressCombo(cdp, "enter");
  await until("document.querySelector('.toast-message')?.textContent === 'Session named: renamed again'");
  const center = await evaluate(cdp, "(() => { const r = document.querySelector('.toast').getBoundingClientRect(); return { x: r.x + 10, y: r.y + 10 }; })()");
  await move(center.x, center.y); await sleep(5300);
  assert.equal(await evaluate(cdp, "!!document.querySelector('.toast')"), true);
  await move(1, 1); await until("!document.querySelector('.toast')");
  result.hoverPauseAndExpiry = true;
  await navigate("command-choices");
  await evaluate(cdp, "document.querySelector('.command-option').click()");
  await until("document.querySelector('.toast-message')?.textContent === 'Forked from first'");
  assert.equal(await evaluate(cdp, "!!document.querySelector('.command-result')"), false);
  result.choiceConfirmation = true;
  await input(`/name ${"unbroken-name-".repeat(200)}`); await pressCombo(cdp, "enter");
  await until("document.querySelector('.toast-message')?.textContent.startsWith('Session named: unbroken-name-')");
  const extreme = await evaluate(cdp, `(() => {
    const toast = document.querySelector('.toast').getBoundingClientRect();
    const close = document.querySelector('.toast-dismiss').getBoundingClientRect();
    const text = document.querySelector('.toast-message');
    return { height: toast.height, closeBottom: close.bottom, viewportHeight: innerHeight, scrollable: text.scrollHeight > text.clientHeight };
  })()`);
  assert.equal(extreme.scrollable, true);
  assert.ok(extreme.closeBottom <= extreme.viewportHeight);
  assert.ok(extreme.height < extreme.viewportHeight / 2);
  result.extremeName = extreme;
  assert.deepEqual(result.errors, []);
  await writeFile(join(out, "acceptance.json"), JSON.stringify(result, null, 2));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
for (const scenario of ["command-confirmation", "command-long-confirmation"]) {
  for (const scheme of ["light", "dark"]) {
    const captured = spawnSync(process.execPath, [resolve("scripts/capture-postures.mjs"), "--url", `${origin}/verification/preview.html?scenario=${scenario}`,
      "--out", out, "--label", `${scenario}-${scheme}`, "--color-scheme", scheme, "--chrome-bin", chromium, "--settle", "800"], { stdio: "inherit" });
    assert.equal(captured.status, 0);
  }
}
console.log(`Passed ${result.cases.length} layout cases, four posture transitions, hover pause, automatic expiry, and choice confirmation. Evidence: ${out}`);
