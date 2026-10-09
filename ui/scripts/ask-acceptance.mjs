#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Ask mode acceptance on the network-free fixture: one bar with one input, the
// draft returns, and the bar fits every posture.
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
  // One bar: exactly one input. The question layer lives inside the composer.
  const surfaces = () => evaluate(cdp, `(() => { const visible = ${shown};
    return { inputs: document.querySelectorAll('[data-composer-input]').length, input: visible('[aria-label="Message"]'),
      questions: visible('.composer [aria-label="Questions from the agent"]'), chatSend: visible('[aria-label="Send message"]') }; })()`);
  const pressEnter = async () => {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  };

  // 1. Type a draft, let the ask open, answer through the real form, and get the draft back.
  url.searchParams.set("scenario", "ask-delayed");
  url.searchParams.set("delay", "1500");
  await cdp.send("Page.navigate", { url: url.href });
  await until(`!!document.querySelector('[aria-label="Message"]')`);
  await evaluate(cdp, `document.querySelector('[aria-label="Message"]').focus()`);
  await cdp.send("Input.insertText", { text: "draft typed before the ask" });
  assert.deepEqual(await surfaces(), { inputs: 1, input: true, questions: false, chatSend: true });
  await until(`!!document.querySelector('[aria-label="Questions from the agent"]')`);
  // Sample through the entry animation: one input throughout, no chat Send.
  for (let frame = 0; frame < 10; frame++) {
    assert.deepEqual(await surfaces(), { inputs: 1, input: true, questions: true, chatSend: false });
    await sleep(20);
  }
  result.swap.focusStaysInInput = await evaluate(cdp, `document.activeElement?.getAttribute('aria-label') === 'Message'`);
  result.swap.draftSetAside = await evaluate(cdp, `document.querySelector('[aria-label="Message"]').value === ''`);
  assert.equal(result.swap.focusStaysInInput, true);
  assert.equal(result.swap.draftSetAside, true);
  await evaluate(cdp, `[...document.querySelectorAll('.ask-option')].find((n) => n.textContent.startsWith('Local storage')).querySelector('input').click()`);
  await evaluate(cdp, `[...document.querySelectorAll('button')].find((n) => n.textContent === 'Next').click()`);
  await until(`document.querySelector('.ask-question')?.textContent.startsWith('Which checks')`);
  await evaluate(cdp, `document.querySelector('[aria-label="Message"]').focus()`);
  await cdp.send("Input.insertText", { text: "format" });
  // Enter in the input advances like Next.
  await pressEnter();
  await until(`document.querySelector('.ask-question')?.textContent.startsWith('What should')`);
  result.swap.rail = await evaluate(cdp, `[...document.querySelectorAll('.ask-step')].map((n) => n.getAttribute('aria-label'))`);
  assert.deepEqual(result.swap.rail, ["Question 1, answered", "Question 2, answered", "Question 3, not answered"]);
  await evaluate(cdp, `[...document.querySelectorAll('button')].find((n) => n.textContent === 'Send answers').click()`);
  await until(`!document.querySelector('[aria-label="Questions from the agent"]')`);
  assert.deepEqual(await surfaces(), { inputs: 1, input: true, questions: false, chatSend: true });
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
          const buttons = [...document.querySelectorAll('.composer-actions button, .ask-head > button')].map((n) => ({ text: n.textContent || n.getAttribute('aria-label'), ...n.getBoundingClientRect().toJSON(), hit: (${hitRect})(n) }));
          return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
            ask: box('.composer'), input: box('[aria-label="Message"]'), inputs: document.querySelectorAll('[data-composer-input]').length, buttons,
            bodyScrolls: body.scrollHeight > body.clientHeight + 1, shadow: getComputedStyle(body).backgroundImage.includes('radial-gradient'),
            share: document.querySelector('.ask').getBoundingClientRect().height / document.querySelector('.session-shell').getBoundingClientRect().height };
        })()`);
        assert.equal(state.overflow, false, `${scenario} ${posture.name} overflows`);
        assert.equal(state.inputs, 1);
        assert.ok(state.ask.y >= 0 && state.ask.bottom <= state.height + 0.5, `${scenario} ${posture.name} bar leaves the viewport`);
        assert.ok(state.input.height >= 44 && state.input.bottom <= state.height, `${scenario} ${posture.name} input is cut off`);
        for (const button of state.buttons) {
          assert.ok(button.hit.height >= 44 && button.hit.width >= 44, `${button.text} target is ${button.hit.width}x${button.hit.height}`);
          assert.ok(button.x >= 0 && button.right <= state.width && button.y >= 0 && button.bottom <= state.height, `${button.text} is off screen at ${posture.name}`);
        }
        assert.ok(state.share <= 0.43, `${scenario} ${posture.name} question layer takes ${state.share}`);
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
