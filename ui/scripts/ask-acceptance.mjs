#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Ask form acceptance on the network-free fixture: the composer and the form are
// never on screen together, the draft returns, and the form fits every posture.
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
const profile = await mkdtemp(join(tmpdir(), "aui-ask-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(chromeBin, "Chromium is required");
const chrome = launchChrome(chromeBin, port, profile);
const url = new URL("/verification/preview.html", process.env.APP_URL ?? "http://127.0.0.1:8510/");
const result = { swap: {}, postures: [], errors: [], apiRequests: [] };
let cdp;
// Both surfaces, by what a user can see: present in the DOM and not hidden.
const shown = `(selector) => { const node = document.querySelector(selector); if (!node) return false;
  const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden'; }`;
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
  const surfaces = () => evaluate(cdp, `(() => { const visible = ${shown};
    return { composer: visible('[aria-label="Message"]'), ask: visible('[aria-label="Questions from the agent"]') }; })()`);

  // 1. Type a draft, let the ask open, answer through the real form, and get the draft back.
  url.searchParams.set("scenario", "ask-delayed");
  url.searchParams.set("delay", "1500");
  await cdp.send("Page.navigate", { url: url.href });
  await until(`!!document.querySelector('[aria-label="Message"]')`);
  await evaluate(cdp, `document.querySelector('[aria-label="Message"]').focus()`);
  await cdp.send("Input.insertText", { text: "draft typed before the ask" });
  assert.deepEqual(await surfaces(), { composer: true, ask: false });
  await until(`!!document.querySelector('[aria-label="Questions from the agent"]')`);
  assert.deepEqual(await surfaces(), { composer: false, ask: true });
  result.swap.focusOnQuestion = await evaluate(cdp, `document.activeElement?.classList.contains('ask-question')`);
  assert.equal(result.swap.focusOnQuestion, true);
  // Sample through the whole entry animation: at no frame are both visible.
  for (let frame = 0; frame < 10; frame++) {
    assert.deepEqual(await surfaces(), { composer: false, ask: true });
    await sleep(20);
  }
  await evaluate(cdp, `[...document.querySelectorAll('.ask-option')].find((n) => n.textContent.startsWith('Local storage')).querySelector('input').click()`);
  await evaluate(cdp, `[...document.querySelectorAll('button')].find((n) => n.textContent === 'Next').click()`);
  await until(`document.querySelector('.ask-question')?.textContent.startsWith('Which checks')`);
  await evaluate(cdp, `document.querySelector('[aria-label="Your own answer"]').focus()`);
  await cdp.send("Input.insertText", { text: "format" });
  // Ctrl+Enter advances like Next.
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 });
  await until(`document.querySelector('.ask-question')?.textContent.startsWith('What should')`);
  result.swap.rail = await evaluate(cdp, `[...document.querySelectorAll('.ask-step')].map((n) => n.getAttribute('aria-label'))`);
  assert.deepEqual(result.swap.rail, ["Question 1, answered", "Question 2, answered", "Question 3, not answered"]);
  await evaluate(cdp, `[...document.querySelectorAll('button')].find((n) => n.textContent === 'Send answers').click()`);
  await until(`!document.querySelector('[aria-label="Questions from the agent"]')`);
  assert.deepEqual(await surfaces(), { composer: true, ask: false });
  result.swap.draftAfterClose = await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value`);
  assert.equal(result.swap.draftAfterClose, "draft typed before the ask");

  // 2. Every posture and scheme, including the soft keyboard and a narrow pane.
  const extraSizes = [{ name: "keyboard-height-emulation", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }];
  for (const scenario of ["ask", "ask-long"]) {
    url.searchParams.delete("delay");
    url.searchParams.set("scenario", scenario);
    await cdp.send("Page.navigate", { url: url.href });
    await until(`!!document.querySelector('.ask-question')`);
    await evaluate(cdp, `document.fonts.ready.then(() => true)`);
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const posture of [...FOLD8_POSTURES, ...extraSizes]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
        await sleep(250);
        const state = await evaluate(cdp, `(() => {
          const box = (s) => document.querySelector(s)?.getBoundingClientRect().toJSON();
          const body = document.querySelector('.ask-body');
          const buttons = [...document.querySelectorAll('.ask-actions button')].map((n) => ({ text: n.textContent || n.getAttribute('aria-label'), ...n.getBoundingClientRect().toJSON() }));
          return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
            ask: box('.ask'), composer: !!document.querySelector('[aria-label="Message"]'), buttons,
            bodyScrolls: body.scrollHeight > body.clientHeight + 1, shadow: getComputedStyle(body).backgroundImage.includes('radial-gradient'),
            share: document.querySelector('.ask').getBoundingClientRect().height / document.querySelector('.session-shell').getBoundingClientRect().height };
        })()`);
        assert.equal(state.overflow, false, `${scenario} ${posture.name} overflows`);
        assert.equal(state.composer, false);
        assert.ok(state.ask.y >= 0 && state.ask.bottom <= state.height + 0.5, `${scenario} ${posture.name} form leaves the viewport`);
        for (const button of state.buttons) {
          assert.ok(button.height >= 44 && button.width >= 44, `${button.text} target is ${button.width}x${button.height}`);
          assert.ok(button.x >= 0 && button.right <= state.width && button.y >= 0 && button.bottom <= state.height, `${button.text} is off screen at ${posture.name}`);
        }
        assert.ok(state.share <= 0.73, `${scenario} ${posture.name} form takes ${state.share}`);
        assert.equal(state.shadow, true);
        result.postures.push({ scenario, scheme, posture: posture.name, bodyScrolls: state.bodyScrolls, share: Number(state.share.toFixed(2)) });
      }
    }
  }
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.apiRequests, []);
  const output = resolve("verification/local");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "ask-acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
