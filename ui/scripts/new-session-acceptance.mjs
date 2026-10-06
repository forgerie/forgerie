#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Deterministic new-session fixtures. A local API in the preview; no network requests or model calls.
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
const output = resolve("verification/local/new-session");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-new-session-"));
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
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (event.request.method !== "GET" || event.request.url.includes("/api/")) result.requests.push(event.request.url); }]);
  async function until(expression, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(30); }
    throw new Error(`Timed out: ${expression}`);
  }
  const click = (selector, text) => evaluate(cdp, `(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.includes(${JSON.stringify(text)})); node?.click(); return !!node; })()`)
    .then((found) => assert.equal(found, true, `no ${selector} "${text}"`));
  async function navigate(scenario, openDestination = false) {
    await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=${scenario}` });
    await until("document.querySelector('.model-trigger')?.textContent.includes('Claude Opus 5.5') && document.querySelector('.destination-value')?.textContent === 'forgerie · new-ui-mvp'");
    if (openDestination) {
      await evaluate(cdp, "document.querySelector('.destination-trigger').click()");
      await until("!!document.querySelector('.destination-panel .destination-row')");
    }
  }
  async function type(text) {
    await evaluate(cdp, "document.querySelector('.composer textarea').focus()"); await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
  }
  const draft = () => evaluate(cdp, "document.querySelector('.composer textarea')?.value");
  async function geometry(scenario, posture, scheme) {
    await sleep(150);
    const state = await evaluate(cdp, `(() => {
      const box = element => element?.getBoundingClientRect().toJSON();
      return { overflow: document.documentElement.scrollWidth > innerWidth, inputs: document.querySelectorAll('.composer textarea').length,
        input: box(document.querySelector('.composer textarea')), destination: box(document.querySelector('.destination-trigger')),
        value: box(document.querySelector('.destination-value')), model: box(document.querySelector('.model-trigger')),
        actions: [...document.querySelectorAll('.composer-actions button')].map(button => ({ label: button.getAttribute('aria-label') || button.textContent, ...box(button) })),
        panel: box(document.querySelector('.destination-panel')), firstRow: box(document.querySelector('.destination-row')) };
    })()`);
    const name = `${scenario} ${posture.name} ${scheme}`;
    const inside = (rect, label) => assert.ok(rect && rect.left >= -0.5 && rect.right <= posture.width + 0.5 && rect.top >= -0.5 && rect.bottom <= posture.height + 0.5,
      `${name}: ${label} outside ${JSON.stringify(rect)}`);
    assert.equal(state.overflow, false, `${name}: overflow`);
    assert.equal(state.inputs, 1, `${name}: one input`);
    for (const [label, rect] of [["input", state.input], ["destination", state.destination], ["model", state.model]]) inside(rect, label);
    assert.ok(state.value.width >= 40, `${name}: destination squeezed to ${state.value.width}`);
    for (const action of state.actions) inside(action, action.label);
    if (state.panel) { inside(state.panel, "panel"); inside(state.firstRow, "first project"); }
    result.geometry.push({ scenario, posture: posture.name, scheme, panel: Boolean(state.panel) });
  }
  for (const [scenario, open] of [["new-session", false], ["new-session", true]]) {
    await navigate(scenario, open);
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const posture of [...FOLD8_POSTURES, { name: "keyboard-budget", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }, { name: "tiny", width: 275, height: 280 }]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
        await geometry(open ? "new-session-destination" : scenario, posture, scheme);
      }
    }
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: FOLD8_POSTURES[2].width, height: FOLD8_POSTURES[2].height, deviceScaleFactor: 2.625, mobile: true });

  // Pick a workspace, a model, and a level; Send starts the session there.
  await navigate("new-session", true);
  assert.equal(await evaluate(cdp, "document.activeElement?.classList.contains('destination-panel')"), true);
  await click(".destination-row", "forgerie");
  await until("document.querySelectorAll('.destination-panel .destination-row').length === 3");
  await click(".destination-row", "main checkout");
  await until("!document.querySelector('.destination-panel') && document.querySelector('.destination-value').textContent === 'forgerie'");
  await evaluate(cdp, "document.querySelector('.model-trigger').click()");
  await until("!!document.querySelector('.model-panel .model-row')");
  await click(".model-row", "Claude Sonnet 5");
  await until("!document.querySelector('.model-panel') && document.querySelector('.model-trigger').textContent.includes('Claude Sonnet 5')");
  await type("Fix the build");
  await pressCombo(cdp, "enter");
  await until("document.querySelector('.connection-status')?.textContent === 'Starting session…'");
  assert.equal(await evaluate(cdp, "document.querySelector('.composer textarea').disabled || document.querySelector('.model-trigger').disabled"), true);
  await until("!!document.documentElement.dataset.started");
  assert.deepEqual(JSON.parse(await evaluate(cdp, "document.documentElement.dataset.started")), { cwd: "/home/simon/code/sandbox/forgerie", text: "Fix the build" });
  result.flows.startHere = true;

  // Escape steps back from workspaces to projects, then closes.
  await navigate("new-session", true);
  await click(".destination-row", "forgerie");
  await until("!!document.querySelector('.destination-back')");
  await pressCombo(cdp, "escape");
  await until("!document.querySelector('.destination-back') && !!document.querySelector('.destination-panel')");
  await pressCombo(cdp, "escape");
  await until("!document.querySelector('.destination-panel')");
  result.flows.escape = true;

  // A refused start keeps the message and says why.
  await navigate("new-session-error");
  await type("Fix the build"); await pressCombo(cdp, "enter");
  await until("!!document.querySelector('.notice')");
  assert.match(await evaluate(cdp, "document.querySelector('.notice').textContent"), /The session did not start: Folder not found/);
  assert.equal(await draft(), "Fix the build");
  result.flows.refusal = true;

  // The draft and the open destination panel survive fold, unfold, and rotation.
  await navigate("new-session");
  await type("unsent first message");
  await evaluate(cdp, "document.querySelector('.destination-trigger').click()");
  await until("!!document.querySelector('.destination-panel .destination-row')");
  for (const posture of [...FOLD8_POSTURES, FOLD8_POSTURES[2]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await sleep(100);
    assert.equal(await draft(), "unsent first message");
    assert.equal(await evaluate(cdp, "!!document.querySelector('.destination-panel')"), true);
    result.transitions.push(posture.name);
  }

  assert.deepEqual(result.requests, []); assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.geometry.length, transitions: result.transitions, flows: result.flows, apiRequests: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
