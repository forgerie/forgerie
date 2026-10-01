#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Deterministic UI fixtures. No API mutations or model calls.
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
const output = resolve("verification/local/compaction");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-compaction-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const result = { geometry: [], errors: [], transitions: [], requests: [] };
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  await cdp.send("Network.enable");
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (event.request.method === "POST") result.requests.push(event.request.url); }]);
  async function until(expression) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(30); }
    throw new Error(`Timed out: ${expression}`);
  }
  async function navigate(scenario) {
    await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=${scenario}` });
    await until("!!document.querySelector('.composer textarea')");
  }
  async function input(text) {
    await evaluate(cdp, "document.querySelector('.composer textarea').focus()"); await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
  }
  async function clickText(text) {
    assert.equal(await evaluate(cdp, `(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(text)}); button?.click(); return !!button; })()`), true);
  }
  async function geometry(scenario, posture, scheme) {
    await sleep(100);
    const state = await evaluate(cdp, `(() => {
      const box = element => element?.getBoundingClientRect().toJSON();
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        inputs: document.querySelectorAll('.composer textarea').length, input: box(document.querySelector('.composer textarea')),
        footer: box(document.querySelector('.composer-region')), notice: box(document.querySelector('.compaction-notice')),
        buttons: [...document.querySelectorAll('.composer-actions button,.compaction-head button')].map(button => ({ label: button.getAttribute('aria-label') || button.textContent, ...box(button) })),
        draft: document.querySelector('.composer textarea').value };
    })()`);
    assert.equal(state.overflow, false, `${scenario}: overflow`);
    assert.equal(state.inputs, 1);
    assert.ok(!state.notice || state.notice.top >= 0, `${scenario}: feedback outside ${JSON.stringify(state)}`);
    assert.ok(state.input.top >= 0 && state.input.bottom <= posture.height, `${scenario}: input outside ${JSON.stringify(state)}`);
    for (const button of state.buttons) {
      assert.ok(button.left >= 0 && button.right <= posture.width && button.top >= 0 && button.bottom <= posture.height,
        `${scenario} ${posture.name}: button outside ${JSON.stringify(button)}`);
    }
    result.geometry.push({ scenario, posture: posture.name, scheme, ...state });
  }
  for (const scenario of ["compaction-queued", "compaction-running", "compaction-complete", "compaction-error", "compaction-reconnecting", "compaction-ask"]) {
    await navigate(scenario);
    if (scenario === "compaction-complete") await evaluate(cdp, "document.querySelector('.compaction-detail').open = true");
    // Narrow/tall and wide/short budgets are checked in addition to the Fold matrix.
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const posture of [...FOLD8_POSTURES, { name: "keyboard-budget", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
        await geometry(scenario, posture, scheme);
      }
    }
  }
  await navigate("compaction-live");
  await input("/comp");
  await until("document.querySelector('[role=option]')?.textContent.includes('/compact')");
  await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, "document.querySelector('.composer textarea').value"), "/compact ");
  assert.equal(await evaluate(cdp, "!!document.querySelector('.compaction-notice')"), false);
  await input("/compact keep release decisions");
  await pressCombo(cdp, "enter");
  await until("document.querySelector('.compaction-notice')?.dataset.phase === 'queued'");
  await until("document.querySelector('.compaction-notice')?.dataset.phase === 'running'");
  await until("document.querySelector('.compaction-notice')?.dataset.phase === 'finished'");
  assert.equal(await evaluate(cdp, "document.querySelector('.compaction-head [role=status]').textContent"), "Compaction complete.");
  assert.equal(await evaluate(cdp, "document.querySelectorAll('.message').length"), 2);
  result.explicitCompletion = true;
  await navigate("compaction-queued");
  await input("draft kept across fold and rotation");
  for (const posture of [...FOLD8_POSTURES, FOLD8_POSTURES[2]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await sleep(80);
    assert.equal(await evaluate(cdp, "document.querySelector('.composer textarea').value"), "draft kept across fold and rotation");
    result.transitions.push(posture.name);
  }
  await clickText("Clear entire queue (2)");
  await until("document.querySelector('.compaction-head [role=status]')?.textContent === 'Queued compaction cancelled.'");
  assert.equal(await evaluate(cdp, "document.querySelector('.composer textarea').value"), "draft kept across fold and rotation");
  result.clearQueueKeepsDraft = true;
  assert.deepEqual(result.requests, []); assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.geometry.length, transitions: result.transitions, explicitCompletion: true, clearQueueKeepsDraft: true, apiMutations: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
