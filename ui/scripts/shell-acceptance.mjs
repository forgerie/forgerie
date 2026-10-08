#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Deterministic UI fixtures for `!` commands. No API mutations or model calls.
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
const output = resolve("verification/local/shell");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-shell-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const result = { geometry: [], errors: [], transitions: [], requests: [], flows: [] };
const budgets = [...FOLD8_POSTURES, { name: "keyboard-budget", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }];
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  await cdp.send("Network.enable");
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (event.request.method === "POST" || event.request.url.includes("/api/")) result.requests.push(event.request.url); }]);
  const until = async (expression, timeout = 20_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(30); }
    throw new Error(`Timed out: ${expression}`);
  };
  const navigate = async (scenario) => {
    await cdp.send("Page.navigate", { url: `${origin}/verification/preview.html?scenario=${scenario}` });
    await until("!!document.querySelector('[data-composer-input]')");
  };
  const input = async (text) => {
    await evaluate(cdp, "document.querySelector('[data-composer-input]').focus()"); await pressCombo(cdp, "ctrl+a");
    await cdp.send("Input.insertText", { text });
  };
  const text = (selector) => evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const button = (label) => evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); return b ? { disabled: b.disabled, ...b.getBoundingClientRect().toJSON() } : null; })()`);
  const resize = (posture) => cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });

  async function geometry(scenario, posture, scheme) {
    await sleep(100);
    const state = await evaluate(cdp, `(() => {
      const box = element => element?.getBoundingClientRect().toJSON();
      const rows = [...document.querySelectorAll('.shell-run')].map(row => {
        const output = row.querySelector('.shell-output');
        return { row: box(row), status: box(row.querySelector('.shell-status')), copy: box(row.querySelector('.shell-header button')),
          command: box(row.querySelector('.shell-command')), outputClipsWidth: output ? output.scrollWidth > output.clientWidth + 1 : false };
      });
      return { overflow: document.documentElement.scrollWidth > innerWidth, inputs: document.querySelectorAll('[data-composer-input]').length,
        input: box(document.querySelector('[data-composer-input]')), rows,
        buttons: [...document.querySelectorAll('.composer-actions button')].map(b => ({ label: b.getAttribute('aria-label') || b.textContent, ...box(b) })),
        draft: document.querySelector('[data-composer-input]').value };
    })()`);
    const where = `${scenario} ${posture.name} ${scheme}`;
    assert.equal(state.overflow, false, `${where}: page overflow`);
    assert.equal(state.inputs, 1, `${where}: one input`);
    assert.ok(state.rows.length > 0, `${where}: shell rows render`);
    assert.ok(state.input.top >= 0 && state.input.bottom <= posture.height, `${where}: input outside ${JSON.stringify(state.input)}`);
    for (const row of state.rows) {
      assert.ok(row.row.right <= posture.width + 0.5, `${where}: row wider than viewport ${JSON.stringify(row.row)}`);
      for (const part of [row.status, row.copy]) assert.ok(part.left >= row.row.left - 0.5 && part.right <= row.row.right + 0.5, `${where}: header item clipped ${JSON.stringify(row)}`);
      assert.equal(row.outputClipsWidth, false, `${where}: output scrolls sideways`);
    }
    for (const control of state.buttons) {
      assert.ok(control.left >= 0 && control.right <= posture.width && control.top >= 0 && control.bottom <= posture.height,
        `${where}: control outside ${JSON.stringify(control)}`);
    }
    result.geometry.push({ scenario, posture: posture.name, scheme, rows: state.rows.length, buttons: state.buttons.map((b) => b.label) });
  }

  // Geometry: history, a running command with a blocked draft, and Run beside Stop during an agent run.
  for (const [scenario, draft] of [["shell", ""], ["shell-blocked", "!pwd"], ["shell-agent", "!date"]]) {
    await navigate(scenario);
    if (draft) await input(draft);
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const posture of budgets) { await resize(posture); await geometry(scenario, posture, scheme); }
    }
  }
  await resize(FOLD8_POSTURES[2]);

  // Run from the composer: Enter runs, the draft clears, and a row arrives in transcript order.
  await navigate("shell");
  await input("!ls -la");
  assert.equal(await text(".composer-hint"), "Shell command. The agent sees its output.");
  assert.equal(await button("Send message"), null);
  const rows = await evaluate(cdp, "document.querySelectorAll('.shell-run').length");
  await pressCombo(cdp, "enter");
  await until(`document.querySelectorAll('.shell-run').length === ${rows + 1}`);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-composer-input]').value"), "");
  assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.shell-command')].at(-1).textContent"), "$ ls -la");
  await input("!!git status");
  assert.equal(await text(".composer-hint"), "Shell command. Its output stays out of the agent's context.");
  assert.equal(await evaluate(cdp, "getComputedStyle(document.querySelector('[data-composer-input]')).fontFamily.includes('JetBrains Mono')"), true);
  await input("!@src");
  assert.equal(await text(".composer-hint"), null);
  result.flows.push("enter-runs-and-clears");

  // A live command follows its newest line, then reports its exit status.
  await navigate("shell-running");
  await until("[...document.querySelectorAll('.shell-status')].at(-1)?.textContent === 'running'");
  await until("(() => { const o = [...document.querySelectorAll('.shell-output')].at(-1); return o.scrollHeight > o.clientHeight + 20; })()");
  await sleep(600);
  assert.equal(await evaluate(cdp, "(() => { const o = [...document.querySelectorAll('.shell-output')].at(-1); return o.scrollHeight - o.scrollTop - o.clientHeight < 8; })()"), true, "live output follows the newest line");
  assert.equal(await text(".connection-status"), "Running shell command");
  await until("[...document.querySelectorAll('.shell-status')].at(-1)?.textContent === 'exit 0'");
  assert.equal(await text(".connection-status"), "Connected");
  result.flows.push("live-follow-and-finish");

  // Blocked: the reason shows and Enter keeps the draft.
  await navigate("shell-blocked");
  await input("!pwd");
  assert.equal(await text(".composer-hint"), "Wait for the running shell command to finish.");
  assert.equal((await button("Run command")).disabled, true);
  await pressCombo(cdp, "enter");
  assert.equal(await evaluate(cdp, "document.querySelector('[data-composer-input]').value"), "!pwd");
  result.flows.push("blocked-keeps-draft");

  // During an agent run, Run and Stop are both reachable.
  await navigate("shell-agent");
  await input("!date");
  assert.ok(await button("Run command")); assert.ok(await button("Stop generating"));
  result.flows.push("run-beside-stop");

  // Ask mode: a shell command goes out through the chat action and the questions stay.
  await navigate("shell-ask");
  await input("!ls src");
  assert.ok(await button("Run command"));
  result.flows.push("ask-routes-shell");

  // The draft survives fold and rotation.
  await navigate("shell");
  await input("!git diff --stat");
  for (const posture of [...FOLD8_POSTURES, FOLD8_POSTURES[2]]) {
    await resize(posture); await sleep(80);
    assert.equal(await evaluate(cdp, "document.querySelector('[data-composer-input]').value"), "!git diff --stat");
    result.transitions.push(posture.name);
  }
  const apiRequests = result.requests.filter((url) => url.includes("/api/"));
  assert.deepEqual(apiRequests, []); assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.geometry.length, flows: result.flows, transitions: result.transitions, apiRequests: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
