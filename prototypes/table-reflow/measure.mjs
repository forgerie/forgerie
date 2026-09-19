// Measures the block height each treatment costs, at each posture width.
//
// Height is the whole argument here: the shipped stacking repeats a column
// heading per record, and the repetition is paid for in vertical space that
// pushes the sentence after the table off the screen.
//
// Usage: node measure.mjs
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_FOLDED_LANDSCAPE, FOLD8_FOLDED_PORTRAIT, FOLD8_UNFOLDED_LANDSCAPE, FOLD8_UNFOLDED_PORTRAIT } from "../../scripts/lib/fold8-postures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = `file://${join(here, "index.html")}`;
const VARIANTS = ["current", "pairs", "prose", "rows"];
const POSTURES = [
  { name: "unfolded-portrait", posture: FOLD8_UNFOLDED_PORTRAIT },
  { name: "unfolded-landscape", posture: FOLD8_UNFOLDED_LANDSCAPE },
  { name: "folded-portrait", posture: FOLD8_FOLDED_PORTRAIT },
  { name: "folded-landscape", posture: FOLD8_FOLDED_LANDSCAPE },
];

const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) {
  process.stderr.write("Chromium not found. Set CHROME_BIN or install chromium.\n");
  process.exit(1);
}

const tempRoot = await mkdtemp(join(tmpdir(), "table-reflow-measure-"));
const debugPort = await getFreePort();
const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
const results = [];

try {
  await waitForDebugger(debugPort);
  for (const { name, posture } of POSTURES) {
    for (const variant of VARIANTS) {
      const cdp = await openPage(debugPort);
      try {
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: posture.width,
          height: posture.height,
          deviceScaleFactor: FOLD8_DPR,
          mobile: true,
        });
        const loaded = cdp.waitForEvent("Page.loadEventFired", 10000).catch(() => undefined);
        await cdp.send("Page.navigate", { url: `${pageUrl}#${variant}.bare` });
        await loaded;
        await sleep(300);
        const { result } = await cdp.send("Runtime.evaluate", {
          expression: "Math.round(document.getElementById('block').getBoundingClientRect().height)",
          returnByValue: true,
        });
        results.push({ posture: name, variant, blockHeightPx: result.value });
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

for (const { name } of POSTURES) {
  const row = results.filter((entry) => entry.posture === name);
  const cells = row.map((entry) => `${entry.variant} ${String(entry.blockHeightPx)}px`).join("  ·  ");
  process.stdout.write(`${name.padEnd(20)} ${cells}\n`);
}
