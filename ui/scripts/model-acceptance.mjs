#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Deterministic model and thinking-level fixtures. No API mutations or model calls.
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
const output = resolve("verification/local/model");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-model-"));
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
    throw new Error(`Timed out: ${expression}`);
  }
  async function navigate(scenario, open = scenario !== "model" && scenario !== "model-error") {
    await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=${scenario}` });
    await until("!!document.querySelector('.composer textarea') && !!document.querySelector('.model-trigger')");
    if (open) await until("!!document.querySelector('.model-panel .model-row') && !!document.querySelector('.model-thinking button, .model-thinking .model-hint:not([role=status])')");
  }
  async function input(text) {
    await evaluate(cdp, "document.querySelector('.composer textarea').focus()"); await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
  }
  const draft = () => evaluate(cdp, "document.querySelector('.composer textarea').value");
  const trigger = () => evaluate(cdp, "document.querySelector('.model-trigger').textContent");
  const focused = () => evaluate(cdp, "document.activeElement?.className + ':' + (document.activeElement?.textContent ?? '')");
  async function clickText(selector, text) {
    assert.equal(await evaluate(cdp, `(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.includes(${JSON.stringify(text)})); node?.click(); return !!node; })()`), true, `no ${selector} with ${text}`);
  }
  async function geometry(scenario, posture, scheme) {
    await sleep(150);
    const state = await evaluate(cdp, `(() => {
      const box = element => element?.getBoundingClientRect().toJSON();
      const panel = document.querySelector('.model-panel');
      const list = document.querySelector('.model-list');
      return { overflow: document.documentElement.scrollWidth > innerWidth, inputs: document.querySelectorAll('.composer textarea').length,
        trigger: box(document.querySelector('.model-trigger')), name: box(document.querySelector('.model-trigger-name')),
        actions: [...document.querySelectorAll('.composer-actions button')].map(button => ({ label: button.getAttribute('aria-label') || button.textContent, ...box(button) })),
        panel: box(panel), list: box(list), search: box(document.querySelector('.model-search')),
        levels: [...document.querySelectorAll('.model-levels button')].map(box), thinking: box(document.querySelector('.model-thinking')),
        firstRow: box(document.querySelector('.model-row')), rows: document.querySelectorAll('.model-row').length };
    })()`);
    const name = `${scenario} ${posture.name} ${scheme}`;
    const inside = (rect, label) => assert.ok(rect.left >= -0.5 && rect.right <= posture.width + 0.5 && rect.top >= -0.5 && rect.bottom <= posture.height + 0.5,
      `${name}: ${label} outside ${JSON.stringify(rect)}`);
    assert.equal(state.overflow, false, `${name}: overflow`);
    assert.equal(state.inputs, 1, `${name}: one input`);
    inside(state.trigger, "trigger");
    assert.ok(state.name.width >= 24, `${name}: model name squeezed to ${state.name.width}`);
    for (const action of state.actions) inside(action, action.label);
    if (state.panel) {
      inside(state.panel, "panel");
      inside(state.search, "search");
      inside(state.thinking, "thinking row");
      for (const level of state.levels) inside(level, "level");
      // At least one whole row stays visible between search and thinking.
      assert.ok(state.list.height >= 44, `${name}: list ${state.list.height}px tall`);
      assert.ok(state.rows > 0, `${name}: no rows`);
    }
    result.geometry.push({ scenario, posture: posture.name, scheme, panel: state.panel ? Math.round(state.panel.height) : 0, list: state.list ? Math.round(state.list.height) : 0 });
  }
  for (const scenario of ["model", "model-open", "model-plain", "model-long", "queue"]) {
    await navigate(scenario, scenario.startsWith("model-"));
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const posture of [...FOLD8_POSTURES, { name: "keyboard-budget", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
        await geometry(scenario, posture, scheme);
      }
    }
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: FOLD8_POSTURES[2].width, height: FOLD8_POSTURES[2].height, deviceScaleFactor: 2.625, mobile: true });

  // Pick a model: the trigger follows, the panel closes, focus returns.
  await navigate("model");
  assert.match(await trigger(), /Claude Opus 5\.5.*High/);
  await input("unsent thought");
  await evaluate(cdp, "document.querySelector('.model-trigger').click()");
  await until("!!document.querySelector('.model-panel .model-row')");
  assert.match(await focused(), /model-row:Claude Opus 5\.5/);
  await pressCombo(cdp, "arrowdown");
  assert.match(await focused(), /model-row:GPT-5\.6 Sol/);
  await clickText(".model-row", "Claude Sonnet 5");
  await until("!document.querySelector('.model-panel')");
  assert.match(await trigger(), /Claude Sonnet 5.*High/);
  assert.match(await focused(), /model-trigger/);
  assert.equal(await draft(), "unsent thought");
  result.flows.pickModel = true;

  // Pick a level: the panel stays, so levels can be compared.
  await evaluate(cdp, "document.querySelector('.model-trigger').click()");
  await until("document.querySelectorAll('.model-levels button').length === 6");
  await clickText(".model-levels button", "Extra high");
  await until("document.querySelector('.model-levels [aria-pressed=true]')?.textContent === 'Extra high'");
  assert.match(await trigger(), /Claude Sonnet 5.*Extra high/);
  assert.equal(await evaluate(cdp, "!!document.querySelector('.model-panel')"), true);
  result.flows.pickLevel = true;

  // The open panel and the draft survive fold, unfold, and rotation.
  for (const posture of [...FOLD8_POSTURES, FOLD8_POSTURES[2]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await sleep(100);
    assert.equal(await draft(), "unsent thought");
    assert.equal(await evaluate(cdp, "!!document.querySelector('.model-panel')"), true);
    const panel = await evaluate(cdp, "document.querySelector('.model-panel').getBoundingClientRect().toJSON()");
    assert.ok(panel.top >= 0 && panel.bottom <= posture.height + 0.5, `${posture.name}: panel ${JSON.stringify(panel)}`);
    result.transitions.push(posture.name);
  }

  // Escape closes; a tap outside closes.
  await pressCombo(cdp, "escape");
  await until("!document.querySelector('.model-panel')");
  await evaluate(cdp, "document.querySelector('.model-trigger').click()");
  await until("!!document.querySelector('.model-panel')");
  await evaluate(cdp, "document.querySelector('.transcript').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
  await until("!document.querySelector('.model-panel')");
  result.flows.closes = true;

  // `/model` opens the picker with its search, and sends nothing.
  await input("/model haiku");
  await until("[...document.querySelectorAll('.composer-actions button')].some(button => button.textContent.trim() === 'Choose model')");
  await pressCombo(cdp, "enter");
  await until("!!document.querySelector('.model-panel .model-row')");
  assert.equal(await draft(), "");
  assert.equal(await evaluate(cdp, "document.querySelector('.model-search').value"), "haiku");
  assert.equal(await evaluate(cdp, "document.querySelectorAll('.model-row').length"), 2);
  result.flows.modelCommand = true;

  // A refusal keeps the old choice and says why.
  await navigate("model-error");
  await evaluate(cdp, "document.querySelector('.model-trigger').click()");
  await until("!!document.querySelector('.model-panel .model-row')");
  await clickText(".model-row", "Claude Sonnet 5");
  await until("!!document.querySelector('.model-error')");
  assert.equal(await evaluate(cdp, "document.querySelector('.model-error').textContent"), "Model not found: anthropic/claude-sonnet-5");
  assert.match(await trigger(), /Claude Opus 5\.5/);
  result.flows.refusal = true;

  assert.deepEqual(result.requests, []); assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.geometry.length, transitions: result.transitions, flows: result.flows, apiMutations: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
