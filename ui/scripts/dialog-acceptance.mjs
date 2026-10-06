#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Deterministic extension-dialog fixtures. No API mutations or model calls.
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
const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const output = resolve("verification/local/dialog");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-dialog-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const result = { geometry: [], errors: [], requests: [], transitions: [], flows: {} };
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  await cdp.send("Network.enable");
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (event.request.method !== "GET") result.requests.push(event.request.url); }]);
  async function until(expression, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(30); }
    throw new Error(`Timed out: ${expression}\nPage: ${await evaluate(cdp, "document.querySelector('.composer')?.innerText")}`);
  }
  async function navigate(scenario) {
    await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=${scenario}` });
    await until(scenario === "dialog-ask" ? "!!document.querySelector('.ask .ask-question')" : "!!document.querySelector('.dialog-layer .ask-question')");
  }
  async function type(text) {
    await evaluate(cdp, "document.querySelector('.composer textarea').focus()"); await pressCombo(cdp, "ctrl+a");
    if (text === "") await pressCombo(cdp, "backspace"); else await cdp.send("Input.insertText", { text });
  }
  const draft = () => evaluate(cdp, "document.querySelector('.composer textarea').value");
  const title = () => evaluate(cdp, "document.querySelector('.dialog-layer .ask-question')?.textContent ?? null");
  const answer = () => evaluate(cdp, "document.documentElement.dataset.dialogAnswer ?? 'unset'");
  async function click(selector, text) {
    assert.equal(await evaluate(cdp, `(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.trim() === ${JSON.stringify(text)}); node?.click(); return !!node; })()`), true, `no ${selector} "${text}"`);
  }
  async function geometry(scenario, posture, scheme) {
    await sleep(150);
    const state = await evaluate(cdp, `(() => {
      const box = element => element?.getBoundingClientRect().toJSON();
      return { overflow: document.documentElement.scrollWidth > innerWidth, inputs: document.querySelectorAll('.composer textarea').length,
        input: box(document.querySelector('.composer textarea')), question: box(document.querySelector('.ask-question')),
        controls: [...document.querySelectorAll('.dialog-head button, .dialog-confirm button, .composer-actions button, .ask-head button')]
          .map(button => ({ label: button.getAttribute('aria-label') || button.textContent.trim(), ...box(button) })),
        firstOption: box(document.querySelector('.dialog-option')), hint: box(document.querySelector('.composer-hint')) };
    })()`);
    const name = `${scenario} ${posture.name} ${scheme}`;
    const inside = (rect, label) => assert.ok(rect.left >= -0.5 && rect.right <= posture.width + 0.5 && rect.top >= -0.5 && rect.bottom <= posture.height + 0.5,
      `${name}: ${label} outside ${JSON.stringify(rect)}`);
    assert.equal(state.overflow, false, `${name}: overflow`);
    assert.equal(state.inputs, 1, `${name}: one input`);
    inside(state.input, "input");
    inside(state.question, "question");
    for (const control of state.controls) inside(control, control.label);
    if (state.firstOption) inside(state.firstOption, "first option");
    if (scenario === "dialog-ask") inside(state.hint, "waiting hint");
    result.geometry.push({ scenario, posture: posture.name, scheme, controls: state.controls.map((control) => control.label) });
  }
  for (const scenario of ["dialog-confirm", "dialog-select", "dialog-input", "dialog-many", "dialog-ask"]) {
    await navigate(scenario);
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const posture of [...FOLD8_POSTURES, { name: "keyboard-budget", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
        await geometry(scenario, posture, scheme);
      }
    }
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: FOLD8_POSTURES[2].width, height: FOLD8_POSTURES[2].height, deviceScaleFactor: 2.625, mobile: true });

  // Three dialogs in turn: Yes, an option, then typed text. The chat draft waits for the input dialog.
  await navigate("dialog-many");
  assert.equal(await evaluate(cdp, "document.querySelector('.dialog-layer .ask-count').textContent"), "1 of 3");
  assert.match(await evaluate(cdp, "document.querySelector('.dialog-countdown').textContent"), /^Closes in 4m \d+s$/);
  assert.equal(await evaluate(cdp, "document.querySelector('.composer > [role=status]').textContent"), "An extension asks: Run the database migration on staging?");
  await click(".dialog-confirm button", "Yes");
  await until("document.querySelector('.dialog-layer .ask-question')?.textContent.startsWith('Which environment')");
  assert.equal(await answer(), "true");
  assert.equal(await evaluate(cdp, "document.querySelector('.dialog-layer .ask-count').textContent"), "1 of 2");
  await type("unsent chat");
  await click(".dialog-option", "production");
  await until("document.querySelector('.dialog-layer .ask-question')?.textContent === 'Name the release tag'");
  assert.equal(await answer(), "\"production\"");
  assert.equal(await draft(), "");
  assert.equal(await evaluate(cdp, "document.querySelector('.composer textarea').placeholder"), "v1.2.3");
  await type("v2.0.0");
  await pressCombo(cdp, "enter");
  await until("!document.querySelector('.dialog-layer')");
  assert.equal(await answer(), "\"v2.0.0\"");
  assert.equal(await draft(), "unsent chat");
  assert.match(await evaluate(cdp, "document.activeElement?.tagName"), /TEXTAREA/);
  result.flows.threeInTurn = true;

  // Skip closes without an answer.
  await navigate("dialog-confirm");
  await click(".dialog-head button", "Skip");
  await until("!document.querySelector('.dialog-layer')");
  assert.equal(await answer(), "null");
  result.flows.skip = true;

  // A refusal keeps the dialog and says why.
  await navigate("dialog-error");
  await click(".dialog-option", "staging");
  await until("!!document.querySelector('.dialog-layer [role=alert]')");
  assert.match(await evaluate(cdp, "document.querySelector('.dialog-layer [role=alert]').textContent"), /refused "staging"/);
  assert.match(await title(), /Which environment/);
  result.flows.refusal = true;

  // An open ask goes first; the dialog waits and the bar says so.
  await navigate("dialog-ask");
  assert.equal(await evaluate(cdp, "!!document.querySelector('.dialog-layer')"), false);
  assert.match(await evaluate(cdp, "document.querySelector('.composer-hint').textContent"), /An extension also asks something/);
  result.flows.askFirst = true;

  // The open dialog and a typed answer survive fold, unfold, and rotation.
  await navigate("dialog-input");
  await type("v3.1.4");
  for (const posture of [...FOLD8_POSTURES, FOLD8_POSTURES[2]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await sleep(100);
    assert.equal(await draft(), "v3.1.4");
    assert.equal(await title(), "Name the release tag");
    result.transitions.push(posture.name);
  }

  assert.deepEqual(result.requests, []); assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.geometry.length, transitions: result.transitions, flows: result.flows, apiMutations: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
