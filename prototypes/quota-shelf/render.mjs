#!/usr/bin/env node
/* Captures each variant's size ladder over CDP.
 *
 * Window sizing is not viewport sizing: headless Chromium clamps small widths
 * and budgets height differently, which is how this repo previously produced
 * clipped-control reports the device never had. So the viewport comes from
 * Emulation.setDeviceMetricsOverride, and the full page comes from
 * captureBeyondViewport.
 *
 *   node prototypes/quota-shelf/render.mjs [outDir]
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? "/tmp/quota-shelf-shots");
const pages = ["a-ledger", "b-fuel", "c-runway", "d-trend"];
const VIEWPORT = { width: 1500, height: 1000, scale: 2 };

// findChrome probes through a login shell, which does not see a `nix shell`
// PATH, so an explicit CHROME_BIN wins.
const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) throw new Error("Chromium not found. Set CHROME_BIN or install chromium.");

await mkdir(outDir, { recursive: true });
const tempRoot = await mkdtemp(join(tmpdir(), "quota-shelf-"));
const debugPort = await getFreePort();
const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));

try {
  await waitForDebugger(debugPort);
  for (const page of pages) {
    const cdp = await openPage(debugPort);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        deviceScaleFactor: VIEWPORT.scale,
        mobile: false,
      });
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
      const loaded = cdp.waitForEvent("Page.loadEventFired", 15000).catch(() => undefined);
      await cdp.send("Page.navigate", { url: `file://${join(here, `${page}.html`)}` });
      await loaded;
      await sleep(600);
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        fromSurface: true,
      });
      const path = join(outDir, `${page}.png`);
      await writeFile(path, Buffer.from(data, "base64"));
      process.stdout.write(`wrote ${path}\n`);
    } finally {
      cdp.close();
    }
  }
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}
