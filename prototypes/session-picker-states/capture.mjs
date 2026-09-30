#!/usr/bin/env node
// Full-page captures of the state sheet in both colour schemes, plus section
// crops. The sheet's frames carry their own pixel widths, so the viewport
// width only decides how frames wrap. Run from the repo root:
//   nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node prototypes/session-picker-states/capture.mjs --out /tmp/picker-shots
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger, evaluate } from "../../scripts/lib/cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "/tmp/picker-shots";
const width = Number(args.includes("--width") ? args[args.indexOf("--width") + 1] : 1400);
const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) { console.error("Chromium not found. Set CHROME_BIN."); process.exit(1); }

await mkdir(out, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "picker-sheet-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, userDataDir, { windowSize: `${width},900` });
try {
  await waitForDebugger(port);
  for (const scheme of ["light", "dark"]) {
    const cdp = await openPage(port);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const url = `file://${resolve(here, "index.html")}`;
    const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
    await cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(1500);
    // Each h2 section, cropped, plus the whole page.
    const sections = await evaluate(cdp, `JSON.stringify([...document.querySelectorAll('.sheet > h2')].map((h, i, all) => { const top = h.getBoundingClientRect().top + scrollY - 8; const next = all[i + 1]; const bottom = next ? next.getBoundingClientRect().top + scrollY - 24 : document.documentElement.scrollHeight; return { i: i + 1, top, height: bottom - top }; }))`);
    const total = await evaluate(cdp, "document.documentElement.scrollHeight");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: Math.ceil(total), deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    for (const s of JSON.parse(sections)) {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: s.top, width, height: s.height, scale: 1 } });
      await writeFile(join(out, `section-${s.i}-${scheme}.png`), Buffer.from(data, "base64"));
    }
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(join(out, `sheet-${scheme}.png`), Buffer.from(data, "base64"));
    console.log(`${scheme}: ${total}px tall`);
    await cdp.close?.();
  }
} finally {
  chrome.kill();
  await rm(userDataDir, { recursive: true, force: true });
}
console.log(`wrote ${out}`);
