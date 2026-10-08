#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Real keyboard input against the network-free presentation fixture.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage, pressCombo } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const output = resolve("verification/local/composer-keyboard");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "forgerie-keys-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const result = { combinations: [], treeCombinations: [], transitions: [], errors: [], apiRequests: [] };
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (new URL(event.request.url).pathname.startsWith("/api/")) result.apiRequests.push(event.request.url); }]);
  async function until(expression) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(40); }
    throw new Error(`Timed out: ${expression}`);
  }
  const draft = () => evaluate(cdp, "document.querySelector('.composer textarea').value");
  async function type(text) {
    await evaluate(cdp, "document.querySelector('.composer textarea').focus()");
    await pressCombo(cdp, "ctrl+a"); await cdp.send("Input.insertText", { text });
  }
  const setCursor = (position) => evaluate(cdp, `document.querySelector('.composer textarea').setSelectionRange(${position}, ${position})`);
  for (const scheme of ["dark", "light"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of [...FOLD8_POSTURES, { name: "short-pane", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=history` });
      await until("!!document.querySelector('.composer textarea')");
      // Focus is a real key chord from outside the input, not a direct focus call.
      await evaluate(cdp, "document.body.tabIndex = -1; document.body.focus()");
      await pressCombo(cdp, "ctrl+alt+i");
      assert.equal(await evaluate(cdp, "document.activeElement === document.querySelector('.composer textarea')"), true);
      await cdp.send("Input.insertText", { text: "unfinished draft" });
      await pressCombo(cdp, "meta+enter"); assert.equal(await draft(), "unfinished draft");
      await setCursor(0);
      await pressCombo(cdp, "arrowup"); assert.equal(await draft(), "Show the smallest session client.");
      await setCursor((await draft()).length); await pressCombo(cdp, "arrowdown");
      assert.equal(await draft(), "unfinished draft");
      assert.equal(await evaluate(cdp, "document.querySelector('.composer textarea').selectionStart"), 0);
      // Hardware Shift is a key in its own right, unlike touch autocapitalization.
      await setCursor((await draft()).length);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifiers: 8 });
      await pressCombo(cdp, "shift+enter");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
      assert.equal(await draft(), "unfinished draft\n");
      await cdp.send("Input.insertText", { text: "second line" });
      await pressCombo(cdp, "enter"); await until("document.querySelector('.composer textarea').value === '' && [...document.querySelectorAll('.message-user')].some(node => node.textContent.includes('second line'))");
      await pressCombo(cdp, "arrowup"); assert.equal(await draft(), "unfinished draft\nsecond line");
      // Dictation uses the same start/finish controls, and never sends the result.
      await type("keep"); await pressCombo(cdp, "ctrl+space");
      await until("document.querySelector('.dictation-status')?.textContent === 'Listening…'");
      await pressCombo(cdp, "ctrl+space");
      await until("document.querySelector('.composer textarea').value === 'keep This is a local dictation preview.'");
      await pressCombo(cdp, "ctrl+space"); await until("document.querySelector('.dictation-status')?.textContent === 'Listening…'");
      await pressCombo(cdp, "escape"); await until("!document.querySelector('.dictation-status') && !document.querySelector('.composer textarea').disabled");
      assert.equal(await draft(), "keep This is a local dictation preview.");
      const geometry = await evaluate(cdp, `(() => {
        const input = document.querySelector('.composer textarea').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.composer-actions button')].map(button => ({ name: button.getAttribute('aria-label') || button.textContent, ...button.getBoundingClientRect().toJSON() }));
        return { overflow: document.documentElement.scrollWidth > innerWidth, input: input.toJSON(), buttons };
      })()`);
      assert.equal(geometry.overflow, false);
      assert.ok(geometry.input.top >= 0 && geometry.input.bottom <= posture.height);
      for (const button of geometry.buttons) assert.ok(button.left >= 0 && button.right <= posture.width && button.top >= 0 && button.bottom <= posture.height, JSON.stringify(button));
      result.combinations.push({ scheme, posture: posture.name, focus: true, history: true, newline: true, send: true, dictation: true, dictationEscape: true, metaEnter: true, geometry });
    }
  }
  await type("state survives rotation"); await setCursor(0); await pressCombo(cdp, "arrowup");
  for (const posture of FOLD8_POSTURES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await sleep(100); assert.equal(await draft(), "unfinished draft\nsecond line");
    result.transitions.push(posture.name);
  }
  await setCursor((await draft()).length); await pressCombo(cdp, "arrowdown"); assert.equal(await draft(), "state survives rotation");
  for (const scheme of ["dark", "light"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of [...FOLD8_POSTURES, { name: "short-pane", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
      await cdp.send("Page.navigate", { url: `${origin}/verification/tree-preview.html?scenario=tree-keyboard` });
      await until("!!document.querySelector('.composer textarea')");
      await evaluate(cdp, "document.querySelector('.composer textarea').focus()");
      await pressCombo(cdp, "escape"); assert.equal(await evaluate(cdp, "!!document.querySelector('.tree-dialog')"), false);
      await pressCombo(cdp, "escape"); await until("!!document.querySelector('.tree-dialog[open] [role=tree]')");
      const geometry = await evaluate(cdp, "document.querySelector('.tree-dialog').getBoundingClientRect().toJSON()");
      assert.ok(geometry.left >= 0 && geometry.right <= posture.width && geometry.top >= 0 && geometry.bottom <= posture.height, JSON.stringify(geometry));
      await pressCombo(cdp, "escape"); await until("!document.querySelector('.tree-dialog')");
      await type("do not discard this"); await pressCombo(cdp, "escape"); await pressCombo(cdp, "escape");
      assert.equal(await draft(), "do not discard this"); assert.equal(await evaluate(cdp, "!!document.querySelector('.tree-dialog')"), false);
      await type("!pwd"); await pressCombo(cdp, "escape"); assert.equal(await draft(), "");
      await pressCombo(cdp, "escape"); assert.equal(await evaluate(cdp, "!!document.querySelector('.tree-dialog')"), false);
      await pressCombo(cdp, "escape"); await until("!!document.querySelector('.tree-dialog[open]')");
      result.treeCombinations.push({ scheme, posture: posture.name, doubleEscape: true, close: true, draftProtection: true, shellEscape: true, geometry });
    }
  }
  assert.deepEqual(result.errors, []); assert.deepEqual(result.apiRequests, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.combinations.length, treeCombinations: result.treeCombinations.length, transitions: result.transitions.length, apiRequests: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
