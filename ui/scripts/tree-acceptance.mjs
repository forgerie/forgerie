#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Session tree navigator: geometry on the Fold matrix and two awkward shapes,
// state kept across fold and rotation, and the keyboard flow. Network-free preview.
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
const { hitRect } = await import(pathToFileURL(resolve("scripts/lib/hit.mjs")));
const origin = process.env.APP_URL ?? "http://127.0.0.1:8510";
const output = resolve("verification/local/session-tree");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-tree-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const shapes = [...FOLD8_POSTURES, { name: "keyboard-budget", width: 475, height: 280 }, { name: "narrow-pane", width: 280, height: 500 }];
const result = { geometry: [], errors: [], transitions: [], requests: [] };
let cdp;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  await cdp.send("Network.enable");
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (event.request.method !== "GET") result.requests.push(event.request.url); }]);
  const until = async (expression) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) { if (await evaluate(cdp, expression)) return; await sleep(30); }
    throw new Error(`Timed out: ${expression}`);
  };
  const resize = (shape) => cdp.send("Emulation.setDeviceMetricsOverride", { width: shape.width, height: shape.height, deviceScaleFactor: 2.625, mobile: true });
  const navigate = async (scenario) => {
    await cdp.send("Page.navigate", { url: `${origin}/verification/tree-preview.html?scenario=${scenario}` });
    await until("!!document.querySelector('dialog.tree-dialog[open] [role=tree]')");
    await sleep(300);
  };
  async function geometry(scenario, shape, scheme) {
    await sleep(120);
    const state = await evaluate(cdp, `(() => {
      const hit = ${hitRect};
      const dialog = document.querySelector('dialog.tree-dialog').getBoundingClientRect().toJSON();
      const list = document.querySelector('.tree-list')?.getBoundingClientRect().toJSON();
      const controls = [...document.querySelectorAll('.tree-dialog button, .tree-dialog input')]
        // A control inside the scrolling body counts as reachable once scrolled to.
        .map((node) => { const target = node.closest("label") ?? node; target.scrollIntoView({ block: "nearest" });
          return { label: node.getAttribute("aria-label") || node.textContent.trim(), ...hit(target) }; });
      const rows = [...document.querySelectorAll('.tree-row')].map((row) => row.getBoundingClientRect().height);
      return { overflow: document.documentElement.scrollWidth > innerWidth, dialog, list, controls, rowMin: Math.min(...rows) };
    })()`);
    assert.equal(state.overflow, false, `${scenario} ${shape.name}: page overflow`);
    assert.ok(state.dialog.left >= -0.5 && state.dialog.right <= shape.width + 0.5 && state.dialog.top >= -0.5 && state.dialog.bottom <= shape.height + 0.5,
      `${scenario} ${shape.name}: dialog outside ${JSON.stringify(state.dialog)}`);
    for (const control of state.controls) {
      // Hit areas may reach past the dialog edge; the drawn control may not.
      const left = control.x + (control.width - control.drawn.width) / 2;
      const top = control.y + (control.height - control.drawn.height) / 2;
      assert.ok(left >= -0.5 && left + control.drawn.width <= shape.width + 0.5 && top >= -0.5 && top + control.drawn.height <= shape.height + 0.5,
        `${scenario} ${shape.name}: ${control.label} outside ${JSON.stringify(control)}`);
      assert.ok(control.height >= 40, `${scenario} ${shape.name}: ${control.label} hit area ${control.height}px tall`);
    }
    assert.ok(state.rowMin >= 43.5, `${scenario} ${shape.name}: a row is ${state.rowMin}px tall`);
    assert.ok(state.list && state.list.height >= 44, `${scenario} ${shape.name}: no room for a row ${JSON.stringify(state.list)}`);
    result.geometry.push({ scenario, shape: shape.name, scheme, dialog: state.dialog, listHeight: state.list.height });
  }
  for (const scenario of ["tree", "tree-all", "tree-summarize", "tree-summarizing", "tree-error"]) {
    await navigate(scenario);
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const shape of shapes) { await resize(shape); await geometry(scenario, shape, scheme); }
    }
  }

  // Lens, search, and selection survive fold and rotation.
  await resize(FOLD8_POSTURES[2]);
  await navigate("tree");
  const pick = (label) => evaluate(cdp, `(() => { const b = [...document.querySelectorAll('.tree-dialog button')].find((n) => n.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`);
  assert.equal(await pick("All"), true);
  await evaluate(cdp, "document.querySelector('.tree-dialog input[type=search]').focus()");
  await cdp.send("Input.insertText", { text: "passed" });
  await until("document.querySelectorAll('.tree-row').length === 1");
  await evaluate(cdp, "[...document.querySelectorAll('.tree-row')].find((r) => r.textContent.includes('41 passed')).click()");
  const viewState = `JSON.stringify({ search: document.querySelector('.tree-dialog input[type=search]').value,
    lens: document.querySelector('.tree-lenses [aria-pressed=true]').textContent,
    selected: document.querySelector('.tree-row[aria-selected=true] .tree-summary').textContent })`;
  const before = await evaluate(cdp, viewState);
  for (const shape of [...FOLD8_POSTURES, FOLD8_POSTURES[2]]) {
    await resize(shape); await sleep(80);
    assert.equal(await evaluate(cdp, viewState), before, `state lost at ${shape.name}`);
    result.transitions.push(shape.name);
  }

  // Keyboard: arrows move, Enter continues, Escape is refused while busy and closes when idle.
  await navigate("tree");
  await until("document.activeElement?.getAttribute('role') === 'treeitem'");
  await pressCombo(cdp, "arrowup");
  assert.equal(await evaluate(cdp, "document.querySelector('.tree-row[aria-selected=true] .tree-summary').textContent"), "Now add the regression test and run the whole auth suite.");
  await pressCombo(cdp, "enter");
  await until("document.querySelector('.tree-continue')?.textContent.includes('Continuing')");
  await pressCombo(cdp, "escape");
  assert.equal(await evaluate(cdp, "!!document.querySelector('dialog.tree-dialog[open]')"), true, "Escape closed a busy navigator");
  await until("document.querySelector('.tree-notice')?.textContent === 'Local preview. Pi did not move the session.'");
  await pressCombo(cdp, "escape");
  await until("!document.querySelector('dialog.tree-dialog')");
  assert.equal(await evaluate(cdp, "document.activeElement?.getAttribute('aria-label') ?? ''"), "", "focus went somewhere unexpected");
  result.keyboard = true;

  assert.deepEqual(result.requests, []); assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.geometry.length, transitions: result.transitions, keyboard: true, apiMutations: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
