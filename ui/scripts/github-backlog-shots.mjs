#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Capture the GitHub backlog states (the real components on fixtures): one sheet of every state per Fold posture and
// colour scheme (each state is its own iframe viewport at that posture), then
// chosen states full page. Requires the dev server (APP_URL, default port 8510).
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES, FOLD8_DPR } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve(process.env.SHOT_DIR ?? "verification/local/github-backlog");
await mkdir(out, { recursive: true });
const base = new URL("/verification/github-backlog.html", process.env.APP_URL ?? "http://127.0.0.1:8510/");
const profile = await mkdtemp(join(tmpdir(), "aui-github-backlog-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(join(out, `${name}.png`), Buffer.from(data, "base64"));
  console.log("captured", name);
}
async function load(params, ready) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  await cdp.send("Page.navigate", { url: url.href });
  for (let i = 0; i < 200 && !(await evaluate(cdp, ready)); i++) await sleep(50);
  await evaluate(cdp, `document.fonts.ready.then(() => true)`);
  await sleep(600);
}
const sheetReady = `[...document.querySelectorAll('iframe')].length > 0 && [...document.querySelectorAll('iframe')].every((f) => f.contentDocument?.querySelector('.app-shell'))`;
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[0], colorScheme: "dark" });
  for (const scheme of (process.env.SCHEMES ?? "light dark").split(" ")) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const posture of FOLD8_POSTURES) {
      // Four frames a row at CSS size, captured at DPR 1 so a sheet stays readable as one image.
      const width = 4 * posture.width + 3 * 32 + 64;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 1200, deviceScaleFactor: 1, mobile: false });
      await load({ state: "all", size: `${posture.width}x${posture.height}` }, sheetReady);
      const height = await evaluate(cdp, `document.documentElement.scrollHeight`);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      await shot(`sheet-${scheme}-${posture.name}`);
    }
    for (const state of (process.env.STATES ?? "list code issue").split(" ").filter(Boolean)) {
      for (const posture of FOLD8_POSTURES) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: FOLD8_DPR, mobile: true });
        await load({ state }, `!!document.querySelector('.app-shell')`);
        await shot(`${state}-${scheme}-${posture.name}`);
      }
    }
  }
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
