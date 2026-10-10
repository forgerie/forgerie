#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Capture the child-agents mockup: the full state sheet at two postures in both
// themes, then chosen states at all four Fold postures. Each capture reports
// page overflow and the focused element, which a sheet must not ring on open.
// Run from ui/ with the dev server up:
//   APP_URL=http://127.0.0.1:8521/ scripts/child-agents-mockup-shots.mjs
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
// Run from ui/. Its parent is the checkout root, which holds scripts/lib.
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve(process.env.OUT ?? "verification/local/child-agents-mockup");
await mkdir(out, { recursive: true });
const base = new URL("/verification/child-agents-mockup.html", process.env.APP_URL ?? "http://127.0.0.1:8521/");
const states = (process.env.STATES ?? "waiting working finished discard conflict worktrees").split(" ");
const schemes = (process.env.SCHEMES ?? "light,dark").split(",");
const sheets = (process.env.SHEETS ?? "folded-portrait,unfolded-landscape").split(",");
const profile = await mkdtemp(join(tmpdir(), "cam-mock-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
const facts = `(() => ({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  focused: document.activeElement === document.body ? "body" : (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.className ?? "?"),
  focusVisible: document.activeElement?.matches?.(":focus-visible") ?? false,
}))()`;
async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(join(out, `${name}.png`), Buffer.from(data, "base64"));
  const result = await evaluate(cdp, facts);
  console.log(join(out, `${name}.png`), JSON.stringify(result));
}
async function load(state) {
  const url = new URL(base); url.searchParams.set("state", state);
  await cdp.send("Page.navigate", { url: url.href });
  for (let i = 0; i < 200 && !(await evaluate(cdp, `!!document.querySelector('.sheet-dialog[open], .mock-sheet')`)); i++) await sleep(50);
  await evaluate(cdp, `document.fonts.ready.then(() => true)`);
  await sleep(400);
}
async function metrics(width, height, scale) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: true });
}
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[0], colorScheme: "light" });
  for (const scheme of schemes) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    // A sheet: one column of frames at the posture under test, full height.
    for (const name of sheets) {
      const posture = FOLD8_POSTURES.find((candidate) => candidate.name === name) ?? FOLD8_POSTURES[0];
      await metrics(posture.width, posture.height, 1.5);
      await load(`all&size=${String(posture.width)}x${String(posture.height)}`);
      const height = await evaluate(cdp, `document.documentElement.scrollHeight`);
      await metrics(posture.width, height, 1.5);
      await sleep(300);
      await shot(`sheet-${name}-${scheme}`);
    }
    // One state, every posture.
    for (const state of states) {
      for (const posture of FOLD8_POSTURES) {
        await metrics(posture.width, posture.height, 1.5);
        await load(state);
        await shot(`${state}-${scheme}-${posture.name}`);
      }
    }
  }
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
