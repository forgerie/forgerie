#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Deterministic skill-record fixtures. No API mutations or model calls.
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
const output = resolve("verification/local/skills");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-skills-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
assert.ok(chromeBin);
const chrome = launchChrome(chromeBin, port, profile);
const result = { geometry: [], errors: [], requests: [], keyboard: {} };
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
    await until("!!document.querySelector('.composer textarea') && !!document.querySelector('.skill-chip')");
  }
  const labels = `[...document.querySelectorAll('details.skill-load > summary .trace-text, details.skill-loads > summary .trace-text')].map(node => node.textContent)`;
  // Every record and its open body stays inside the posture, with no page overflow.
  async function geometry(scenario, posture, scheme) {
    await sleep(120);
    const state = await evaluate(cdp, `(() => {
      const box = element => element.getBoundingClientRect().toJSON();
      const column = box(document.querySelector('.thread-column'));
      return { overflow: document.documentElement.scrollWidth > innerWidth, column,
        records: [...document.querySelectorAll('.skill-chip, details.skill-load > summary, details.skill-loads > summary, .skill-invocation-body, .skill-load .trace-body')]
          .map(element => ({ name: element.className || element.parentElement.className, ...box(element) })),
        chipHeight: box(document.querySelector('.skill-chip')).height,
        inputs: document.querySelectorAll('.composer textarea').length };
    })()`);
    assert.equal(state.overflow, false, `${scenario} ${posture.name}: page overflow`);
    assert.equal(state.inputs, 1);
    assert.ok(state.chipHeight >= 44, `${scenario} ${posture.name}: chip below the 44px target ${state.chipHeight}`);
    for (const record of state.records) {
      assert.ok(record.left >= state.column.left - 1 && record.right <= state.column.right + 1,
        `${scenario} ${posture.name}: record outside the column ${JSON.stringify(record)}`);
    }
    result.geometry.push({ scenario, posture: posture.name, scheme, records: state.records.length });
  }
  for (const scenario of ["skills", "skills-open", "skills-invocation", "skills-running"]) {
    await navigate(scenario);
    if (scenario === "skills-open") await until("document.querySelectorAll('.skill-invocation[open] pre, details.skill-load[open] pre').length >= 3");
    if (scenario === "skills-invocation") await until("!!document.querySelector('.skill-invocation[open] pre')");
    for (const scheme of ["light", "dark"]) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const posture of [...FOLD8_POSTURES, { name: "narrow-pane", width: 280, height: 500 }]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
        await geometry(scenario, posture, scheme);
      }
    }
  }

  // Content: the typed command, its argument, and each load's state.
  await navigate("skills");
  assert.deepEqual(await evaluate(cdp, "[...document.querySelectorAll('.skill-chip')].map(node => node.textContent)"), ["/skill:handoff", "/skill:testing-guide"]);
  assert.equal(await evaluate(cdp, "document.querySelectorAll('.message-user .user-bubble').length"), 1);
  assert.equal(await evaluate(cdp, "document.body.textContent.includes('<skill')"), false);
  assert.deepEqual(await evaluate(cdp, labels), [
    "loaded 3 skills: simple-english, unslop, bedrock-principles",
    "loaded skill simple-english", "loaded skill unslop", "loaded skill bedrock-principles",
    "failed to load skill a-skill-name-that-is-much-longer-than-any-pane-is-wide",
  ]);
  assert.equal(await evaluate(cdp, "[...document.querySelectorAll('details.chain-of-thought')].some(group => group.querySelector('.skill-load'))"), false);
  await navigate("skills-running");
  assert.equal(await evaluate(cdp, `${labels}[0]`), "loading 3 skills: simple-english, unslop, bedrock-principles");
  assert.equal(await evaluate(cdp, "document.querySelector('details.skill-loads > summary .trace-text').hasAttribute('data-live')"), true);

  // Keyboard: both records open and close from the keyboard and keep focus.
  await navigate("skills");
  for (const [name, selector] of [["invocation", ".skill-chip"], ["loads", "details.skill-loads > summary"]]) {
    await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).focus()`);
    await pressCombo(cdp, "enter");
    await until(`document.querySelector(${JSON.stringify(selector)}).parentElement.open`);
    result.keyboard[name] = await evaluate(cdp, `document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
    assert.equal(result.keyboard[name], true);
  }
  await until("document.querySelector('.skill-invocation-body pre')?.textContent.startsWith('References are relative')");
  assert.deepEqual(result.requests, []); assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: result.geometry.length, keyboard: result.keyboard, apiMutations: 0, errors: 0 }));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(200);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
