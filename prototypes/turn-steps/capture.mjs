#!/usr/bin/env node
// Full-page captures of the turn-steps prototype at Fold 8 posture widths.
// Run from the repo root:
//   nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node prototypes/turn-steps/capture.mjs --out /tmp/turn-steps
// Options: --scheme light|dark  --postures folded-portrait,unfolded-landscape  --cases rail:settled:chatty,...
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger, evaluate } from "../../scripts/lib/cdp.mjs";
import { FOLD8_POSTURES } from "../../scripts/lib/fold8-postures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const out = opt("out", "/tmp/turn-steps");
const scheme = opt("scheme", "dark");
const postureNames = opt("postures", "folded-portrait,unfolded-landscape").split(",");
const cases = opt("cases", "now:settled:chatty,rail:settled:chatty,margin:settled:chatty,status:settled:chatty").split(",");
const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) { console.error("Chromium not found. Set CHROME_BIN."); process.exit(1); }

await mkdir(out, { recursive: true });
const userDataDir = await mkdtemp(join(tmpdir(), "turn-steps-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, userDataDir);
try {
  await waitForDebugger(port);
  for (const posture of FOLD8_POSTURES.filter((p) => postureNames.includes(p.name))) {
    for (const c of cases) {
      const [v, mode, talk] = c.split(":");
      const cdp = await openPage(port);
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 1.5, mobile: true });
      const url = `file://${resolve(here, "index.html")}?v=${v}&mode=${mode}&talk=${talk}&bar=0`;
      const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
      await cdp.send("Page.navigate", { url });
      await loaded;
      await sleep(800);
      const total = Math.ceil(await evaluate(cdp, "document.documentElement.scrollHeight"));
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: posture.width, height: total, scale: 1 } });
      const file = join(out, `${v}-${mode}-${talk}-${posture.name}-${scheme}.png`);
      await writeFile(file, Buffer.from(data, "base64"));
      console.log(`${file} ${posture.width}x${total}`);
      cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  await sleep(500);
  await rm(userDataDir, { recursive: true, force: true, maxRetries: 5 });
}
