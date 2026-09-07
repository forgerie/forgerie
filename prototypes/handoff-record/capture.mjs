// Captures the handoff-record variants over CDP viewport emulation.
//
// Same reason as interim-voice/capture.mjs: headless chromium clamps
// --window-size below ~500px, so the folded widths are emulated instead.
//
// Usage: node capture.mjs
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_FOLDED_LANDSCAPE, FOLD8_FOLDED_PORTRAIT, FOLD8_UNFOLDED_LANDSCAPE } from "../../scripts/lib/fold8-postures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = `file://${join(here, "index.html")}`;

const VARIANTS = ["today", "receipt", "record", "thread", "boundary"];
const SHOTS = [
  { name: "wide", posture: FOLD8_UNFOLDED_LANDSCAPE },
  { name: "folded", posture: FOLD8_FOLDED_PORTRAIT },
  { name: "strip", posture: FOLD8_FOLDED_LANDSCAPE },
];

const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) {
  process.stderr.write("Chromium not found. Set CHROME_BIN or install chromium.\n");
  process.exit(1);
}

const tempRoot = await mkdtemp(join(tmpdir(), "handoff-record-"));
const debugPort = await getFreePort();
const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));

try {
  await waitForDebugger(debugPort);
  for (const variant of VARIANTS) {
    for (const shot of SHOTS) {
      const cdp = await openPage(debugPort);
      try {
        await cdp.send("Page.enable");
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: shot.posture.width,
          height: shot.posture.height,
          deviceScaleFactor: FOLD8_DPR,
          mobile: true,
        });
        const loaded = cdp.waitForEvent("Page.loadEventFired", 10000).catch(() => undefined);
        await cdp.send("Page.navigate", { url: `${pageUrl}#${variant}.bare.h1` });
        await loaded;
        await sleep(500);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
        const out = join(here, `${variant}-${shot.name}.png`);
        await writeFile(out, Buffer.from(data, "base64"));
        process.stdout.write(`wrote ${variant}-${shot.name}.png (${String(shot.posture.width)}x${String(shot.posture.height)})\n`);
      } finally {
        cdp.close();
      }
    }
  }
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}
