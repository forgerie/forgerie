#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium --command node
// Local fixture acceptance. No real child, Git operation, or back-end request is allowed.
// Run from ui/: APP_URL=http://127.0.0.1:8538/ scripts/child-agents-mockup-check.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const base = process.env.APP_URL ?? "http://127.0.0.1:8538/";
const profile = await mkdtemp(join(tmpdir(), "child-mockup-check-"));
const port = await getFreePort();
const chrome = launchChrome(spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
const button = (label) => `[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(label)})`;
async function wait(expression) {
  const deadline = Date.now() + 10_000;
  while (!(await evaluate(cdp, expression))) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${expression}`);
    await sleep(30);
  }
}
async function load(state) {
  await cdp.send("Page.navigate", { url: new URL(`/verification/child-agents-mockup.html?state=${state}`, base).href });
  await wait("!!document.querySelector('.sheet-dialog[open]')");
  await evaluate(cdp, "document.fonts.ready.then(()=>true)");
  await sleep(80);
  assert.equal(await evaluate(cdp, "document.documentElement.scrollWidth > innerWidth"), false, `${state}: horizontal overflow`);
}
async function visible(label) {
  const result = await evaluate(cdp, `(() => { const e=${button(label)}; if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })()`);
  assert.equal(result, true, `Action not reachable without scrolling: ${label}`);
}
async function click(label) { await visible(label); await evaluate(cdp, `${button(label)}.click()`); await sleep(80); }
async function includes(text) { assert.equal(await evaluate(cdp, `document.body.innerText.includes(${JSON.stringify(text)})`), true, text); }
async function field(placeholder) { assert.equal(await evaluate(cdp, "document.querySelector('textarea')?.placeholder"), placeholder); }
async function enter(text) { await evaluate(cdp, "document.querySelector('textarea').focus()"); await cdp.send("Input.insertText", { text }); await sleep(50); }

try {
  await waitForDebugger(port);
  for (const scheme of ["light", "dark"]) for (const posture of FOLD8_POSTURES) {
    cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
    await load("list");
    await includes("1 is ready to land.");
    await click("Show worktrees");
    await includes("Eligible for cleanup");
    await click("All child agents");
    // The collection may scroll; primary branch actions must not require it.
    await evaluate(cdp, `${button("Open docs")}.scrollIntoView({block:'center'})`);
    await click("Open docs");
    await visible("Review changes"); await visible("Land on main"); await visible("Discard branch");
    assert.equal(await evaluate(cdp, `${button("Land on main")}.disabled`), true);
    await includes("Commit or discard the 3 uncommitted files");
    await click("Review changes"); await includes("Illustrative preview diff");
    await click("Back to report");
    await click("Discard branch");
    await includes("3 uncommitted files");
    await click("Keep the branch");
    await click("Continue working"); await field("Continue docs on docs/children-guide");
    await click("Branch actions");
    await click("Discard branch"); await click("Discard branch");
    await includes("The old worktree is gone.");
    assert.equal(await evaluate(cdp, "document.querySelector('textarea') === null"), true);
    await click("Start new task from main"); await field("New task from main"); await includes("main checkout");

    await load("finished");
    for (const action of ["Review changes", "Land on main", "Discard branch", "Continue working"]) await visible(action);
    await click("Land on main"); await includes("Worktree landed and removed");
    assert.equal(await evaluate(cdp, "document.querySelector('textarea') === null"), true);
    await click("All child agents"); await includes("0 are ready to land.");
    await evaluate(cdp, `${button("Open review")}.scrollIntoView({block:'center'})`);
    await click("Open review"); await includes("Worktree landed and removed");
    assert.equal(await evaluate(cdp, "document.querySelector('textarea') === null"), true);

    await load("waiting"); await visible("Stop"); await enter("Keep the last run");
    // Rotation changes the container, not the selected child or the answer draft.
    const rotated = FOLD8_POSTURES.find((candidate) => candidate.name !== posture.name);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: rotated.width, height: rotated.height, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate(cdp, "document.querySelector('textarea').value"), "Keep the last run");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 1, mobile: true });
    await click("Send answer"); await includes("Preview message to ui: Keep the last run"); await visible("Stop");
    await click("Stop"); await includes("Stopped in this preview");
    await load("waiting"); await click("Stop"); await includes("Question cancelled in this preview.");

    await load("working"); await click("Runs (3) · $0.51"); await includes("Run history");
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.cam-run summary svg').length"), 3);
    await evaluate(cdp, "document.querySelector('.cam-run summary').click()");
    assert.equal(await evaluate(cdp, "document.querySelector('.cam-run').open"), true);
    await click("Stop"); await visible("Review changes");

    for (const state of ["conflict", "blocked", "stale"]) {
      await load(state); await visible("Review changes"); await visible("Discard branch");
      assert.equal(await evaluate(cdp, `(() => { const card=document.querySelector('.alert-card').getBoundingClientRect(); const body=document.querySelector('.sheet-dialog-body').getBoundingClientRect(); return card.top>=body.top && card.bottom<=body.bottom+1; })()`), true, `${state}: refusal must be visible`);
      if (state === "blocked") { await includes("does not guarantee a conflict-free land"); await click("Show worktrees"); }
      if (state === "stale") { await click("Review updated branch"); await includes("Illustrative preview diff"); }
      if (state === "conflict") { await click("Check again"); await includes("Illustrative preview diff"); }
    }
    assert.equal(await evaluate(cdp, "performance.getEntriesByType('resource').some(e => /\\/(api|aui)\\//.test(new URL(e.name).pathname))"), false);
    console.log(`PASS ${scheme} ${posture.name}: action visibility, readiness, diff, discard, landing, question, stop, runs, refusals, rotation draft`);
    cdp.close(); cdp = undefined;
  }
} finally {
  cdp?.close(); chrome.kill(); await sleep(300);
  await rm(profile, { recursive: true, force: true });
}
