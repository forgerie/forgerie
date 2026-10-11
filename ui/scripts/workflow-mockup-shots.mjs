#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Capture the workflow mockup: every state at the chosen Fold postures and
// schemes, then the storyboard. Each capture reports page overflow, which no
// state may have.
// Run from ui/ with the dev server up:
//   APP_URL=http://127.0.0.1:8561/ scripts/workflow-mockup-shots.mjs
// STATES, SCHEMES, POSTURES and BOARD (a posture name, or "none") narrow the run.
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve(process.env.OUT ?? "verification/local/workflow-mockup");
await mkdir(out, { recursive: true });
const base = new URL("/verification/workflow-mockup.html", process.env.APP_URL ?? "http://127.0.0.1:8561/");
const states = (process.env.STATES ?? "suggest ask plan contract building run question child change review stuck ready landed history").split(" ");
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const postures = (process.env.POSTURES ?? FOLD8_POSTURES.map((posture) => posture.name).join(",")).split(",");
const board = process.env.BOARD ?? "unfolded-portrait";
const profile = await mkdtemp(join(tmpdir(), "wf-mock-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
const overflow = `(() => {
  const page = document.documentElement.scrollWidth > document.documentElement.clientWidth;
  const sheet = [...document.querySelectorAll('.sheet-dialog-body')].some((node) => node.scrollWidth > node.clientWidth + 1);
  return { page, sheet };
})()`;
async function load(params, selector) {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  await cdp.send("Page.navigate", { url: url.href });
  const deadline = Date.now() + 10_000;
  while (!(await evaluate(cdp, `!!document.querySelector(${JSON.stringify(selector)})`))) {
    if (Date.now() > deadline) throw new Error(`Mockup did not render: ${url.href}`);
    await sleep(50);
  }
  await evaluate(cdp, `document.fonts.ready.then(() => true)`);
  await sleep(500);
}
async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, `${name}.png`), Buffer.from(data, "base64"));
  console.log(join(out, `${name}.png`), JSON.stringify(await evaluate(cdp, overflow)));
}
try {
  await waitForDebugger(port);
  for (const scheme of schemes) {
    for (const name of postures) {
      const posture = FOLD8_POSTURES.find((candidate) => candidate.name === name);
      if (!posture) throw new Error(`Unknown posture ${name}`);
      cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      for (const state of states) {
        await load({ state }, ".session-shell");
        await shot(`${state}-${name}-${scheme}`);
      }
      await cdp.close?.();
    }
    if (board !== "none") {
      const posture = FOLD8_POSTURES.find((candidate) => candidate.name === board);
      cdp = await openPosturePage({ debugPort: port, posture: { ...posture, width: 1600, height: 1000 }, colorScheme: scheme });
      await load({ state: "all", size: `${String(posture.width)}x${String(posture.height)}`, zoom: "0.5" }, ".mock-board-grid");
      const ready = `[...document.querySelectorAll('.mock-device iframe')].every((frame) => frame.contentDocument?.querySelector('.session-shell'))`;
      const deadline = Date.now() + 15_000;
      while (!(await evaluate(cdp, ready))) {
        if (Date.now() > deadline) throw new Error("Storyboard frames did not all load");
        await sleep(100);
      }
      await sleep(1200);
      const height = await evaluate(cdp, "document.documentElement.scrollHeight");
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height, deviceScaleFactor: 1.5, mobile: false });
      await sleep(800);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await writeFile(join(out, `storyboard-${board}-${scheme}.png`), Buffer.from(data, "base64"));
      console.log(join(out, `storyboard-${board}-${scheme}.png`));
      await cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  // Chromium still writes its profile for a moment after the kill.
  await sleep(1000);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
