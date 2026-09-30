#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Capture the ask-mode mockup: the full state sheet in both themes, then chosen
// states at the four Fold postures. Requires the dev server on 8510.
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve("verification/local/ask-mockup");
await mkdir(out, { recursive: true });
const base = new URL("/verification/ask-mockup.html", process.env.APP_URL ?? "http://127.0.0.1:8510/");
const profile = await mkdtemp(join(tmpdir(), "aui-mock-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
async function shot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(join(out, `${name}.png`), Buffer.from(data, "base64"));
  console.log("captured", name);
}
async function load(state) {
  const url = new URL(base); url.searchParams.set("state", state);
  await cdp.send("Page.navigate", { url: url.href });
  for (let i = 0; i < 200 && !(await evaluate(cdp, `!!document.querySelector('.session-shell')`)); i++) await sleep(50);
  await evaluate(cdp, `document.fonts.ready.then(() => true)`);
  await sleep(200);
}
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[0], colorScheme: "dark" });
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 2100, height: 1500, deviceScaleFactor: 1, mobile: false });
    await load("all");
    const height = await evaluate(cdp, `document.documentElement.scrollHeight`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 2100, height, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    await shot(`sheet-${scheme}`);
    for (const state of (process.env.STATES ?? "options slash image").split(" ")) {
      for (const posture of FOLD8_POSTURES) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 1.5, mobile: true });
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
