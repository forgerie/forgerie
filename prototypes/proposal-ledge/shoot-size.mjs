#!/usr/bin/env node
// Shoots scenes at one viewport that is not a Fold posture, such as a 320 x 568 phone.
//   node shoot-size.mjs --width 320 --height 568 --scheme light --label tiny one many-open both
// Run it through render.sh's shell (nodejs_24 and chromium), from this folder.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { drivePage, openPosturePage } from "../../scripts/lib/posture-page.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index === -1 ? fallback : args.splice(index, 2)[1]; };
const width = Number(option("width", "320"));
const height = Number(option("height", "568"));
const scheme = option("scheme", "light");
const label = option("label", `${width}x${height}`);
const scenes = args;
const here = fileURLToPath(new URL(".", import.meta.url));

const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
const temp = await mkdtemp(join(tmpdir(), "ledge-shots-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, join(temp, "profile"));
try {
  await waitForDebugger(port);
  await mkdir(join(here, "shots"), { recursive: true });
  for (const scene of scenes) {
    const cdp = await openPosturePage({ debugPort: port, posture: { name: label, width, height }, colorScheme: scheme });
    try {
      await drivePage(cdp, { url: `file://${here}index.html?scene=${scene}`, settle: 800, label });
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const out = join(here, "shots", `${scheme}-${scene}-${label}.png`);
      await writeFile(out, Buffer.from(data, "base64"));
      process.stdout.write(`captured ${out}\n`);
    } finally { cdp.close(); }
  }
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  await rm(temp, { recursive: true, force: true });
}
