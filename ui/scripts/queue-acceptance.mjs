#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Deterministic sending-while-working fixtures. No API mutations or model calls.
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
const output = resolve("verification/local/queue");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-queue-"));
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
  async function until(expression) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(30); }
    throw new Error(`Timed out: ${expression}`);
  }
  async function navigate(scenario) {
    await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=${scenario}` });
    await until("!!document.querySelector('.composer textarea') && !!document.querySelector('[aria-label=\"Stop generating\"]')");
  }
  async function input(text) {
    await evaluate(cdp, "document.querySelector('.composer textarea').focus()"); await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
  }
  const draft = () => evaluate(cdp, "document.querySelector('.composer textarea').value");
  const rows = () => evaluate(cdp, "[...document.querySelectorAll('section.queue .queue-item')].map(row => row.querySelector('.queue-kind').textContent + ': ' + row.querySelector('.queue-text').textContent)");
  async function click(label) {
    assert.equal(await evaluate(cdp, `(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)} || button.getAttribute('aria-label') === ${JSON.stringify(label)}); button?.click(); return !!button; })()`), true, `no ${label}`);
  }
  async function geometry(scenario, posture, scheme) {
    await sleep(120);
    const state = await evaluate(cdp, `(() => {
      const box = element => element?.getBoundingClientRect().toJSON();
      const column = box(document.querySelector('.thread-column'));
      return { overflow: document.documentElement.scrollWidth > innerWidth, column,
        inputs: document.querySelectorAll('.composer textarea').length, input: box(document.querySelector('.composer textarea')),
        list: box(document.querySelector('.queue-items')), rows: [...document.querySelectorAll('.queue-item')].map(box),
        buttons: [...document.querySelectorAll('.composer-actions button,.queue-head button,.compaction-head button')]
          .map(button => ({ label: button.getAttribute('aria-label') || button.textContent, ...box(button) })) };
    })()`);
    const name = `${scenario} ${posture.name} ${scheme}`;
    assert.equal(state.overflow, false, `${name}: overflow`);
    assert.equal(state.inputs, 1, `${name}: one input`);
    assert.ok(state.input.top >= 0 && state.input.bottom <= posture.height, `${name}: input outside ${JSON.stringify(state.input)}`);
    for (const button of state.buttons) {
      assert.ok(button.left >= 0 && button.right <= posture.width && button.top >= 0 && button.bottom <= posture.height,
        `${name}: button outside ${JSON.stringify(button)}`);
    }
    if (state.list) {
      assert.ok(state.list.left >= state.column.left - 1 && state.list.right <= state.column.right + 1, `${name}: queue outside the column`);
      // The list scrolls inside its budget instead of pushing the input away.
      assert.ok(state.list.height <= Math.max(9 * 16, 0.22 * posture.height) + 1, `${name}: queue too tall ${state.list.height}`);
    }
    result.geometry.push({ scenario, posture: posture.name, scheme, rows: state.rows.length, buttons: state.buttons.map((button) => button.label) });
  }
  for (const scenario of ["queue", "queue-compaction", "queue-attachments", "compaction-queued"]) {
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

  // What each state offers.
  await navigate("queue");
  assert.deepEqual(await rows(), [
    "Steer: Use the existing retry helper instead of writing a new one.",
    "Follow-up: After this, add tests for the reconnect path and run the full suite.",
    `Follow-up: Then update the verification notes. ${"Keep the wording short and name each check that ran. ".repeat(4)}`,
  ]);
  assert.deepEqual(await evaluate(cdp, "[...document.querySelectorAll('.composer-actions button')].slice(-3).map(button => button.getAttribute('aria-label') || button.textContent)"),
    ["Steer", "Queue message", "Stop generating"]);
  assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Stop generating\"]').title"), "Stop and return queued messages to the draft");
  await navigate("queue-compaction");
  assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.composer-actions button')].some(button => button.textContent === 'Steer')"), false);
  assert.equal(await evaluate(cdp, "!!document.querySelector('.compaction-notice')"), false);
  await navigate("queue-attachments");
  await until("document.querySelectorAll('.composer-attachments .attachment').length === 1");
  assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Queue message\"]').disabled"), true);
  assert.match(await evaluate(cdp, "document.querySelector('.ask-route').textContent"), /Queued messages are text only/);
  result.flows.attachmentsBlocked = true;

  // Keyboard and buttons: Enter queues, Ctrl+Shift+Enter steers, Shift+Enter is a new line.
  await navigate("queue-live");
  await input("add tests after this"); await pressCombo(cdp, "shift+enter");
  assert.equal(await draft(), "add tests after this\n");
  await pressCombo(cdp, "enter");
  await until("document.querySelectorAll('section.queue .queue-item').length === 1");
  assert.equal(await draft(), "");
  await input("use the existing helper"); await pressCombo(cdp, "ctrl+shift+enter");
  await until("document.querySelectorAll('section.queue .queue-item').length === 2");
  await input("check the folded layout"); await click("Steer");
  await until("document.querySelectorAll('section.queue .queue-item').length === 3");
  assert.deepEqual(await rows(), ["Steer: use the existing helper", "Steer: check the folded layout", "Follow-up: add tests after this\n"]);
  result.flows.keyboardAndButtons = true;

  // The draft and the queue survive fold, unfold, and rotation.
  await input("unsent thought");
  for (const posture of [...FOLD8_POSTURES, FOLD8_POSTURES[2]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await sleep(80);
    assert.equal(await draft(), "unsent thought");
    assert.equal((await rows()).length, 3);
    result.transitions.push(posture.name);
  }

  // Stop returns the queue to the draft in delivery order, ahead of the unsent text.
  await click("Stop generating");
  await until("!document.querySelector('section.queue')");
  assert.equal(await draft(), "use the existing helper\n\ncheck the folded layout\n\nadd tests after this\n\n\nunsent thought");
  result.flows.stopRestores = true;

  // Clearing removes every item, keeps the draft, and the run continues.
  await navigate("queue");
  await click("Clear entire queue (3)");
  await until("!document.querySelector('section.queue')");
  assert.equal(await draft(), "Also check the folded landscape layout.");
  assert.equal(await evaluate(cdp, "!!document.querySelector('[aria-label=\"Stop generating\"]')"), true);
  result.flows.clearKeepsDraftAndRun = true;

  assert.deepEqual(result.requests, []); assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.geometry.length, transitions: result.transitions, flows: result.flows, apiMutations: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
