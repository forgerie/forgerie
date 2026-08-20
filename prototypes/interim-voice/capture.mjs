// Captures the interim-voice variants over CDP viewport emulation.
//
// prototypes/capture.sh drives --window-size, and headless chromium clamps
// window widths below ~500px (a 475 request lays out at 500 and the shot
// crops the right edge — see AGENTS.md). This script emulates the two
// bracket postures the way scripts/capture-postures.mjs does, so the folded
// widths are honest.
//
// Usage: node capture.mjs
import { writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_FOLDED_PORTRAIT, FOLD8_UNFOLDED_LANDSCAPE } from "../../scripts/lib/fold8-postures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = `file://${join(here, "index.html")}`;

const VARIANTS = ["today", "registers", "rail", "promote"];
const SHOTS = [
  { name: "overview", posture: FOLD8_UNFOLDED_LANDSCAPE, flags: "bare" },
  { name: "answer", posture: FOLD8_FOLDED_PORTRAIT, flags: "bare.answer" },
  { name: "tail", posture: FOLD8_FOLDED_PORTRAIT, flags: "bare.tail" },
];

const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) {
  process.stderr.write("Chromium not found. Set CHROME_BIN or install chromium.\n");
  process.exit(1);
}

const tempRoot = await mkdtemp(join(tmpdir(), "interim-voice-"));
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
        await cdp.send("Page.navigate", { url: `${pageUrl}#${variant}.${shot.flags}` });
        await loaded;
        await sleep(600);
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
