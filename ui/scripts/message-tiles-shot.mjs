#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Captures a sent message's file tiles: opens the images preview, scrolls the
// user message with attachments into view, and shoots each Fold 8 posture.
//   scripts/message-tiles-shot.mjs [url] [out]
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const url = process.argv[2] ?? "http://127.0.0.1:8521/verification/preview.html?scenario=images";
const out = process.argv[3] ?? "verification/local/attachment-tray";
await mkdir(out, { recursive: true });
const chrome = launchChrome(execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(), await getFreePort().then((port) => (globalThis.port = port)),
  await mkdtemp(join(tmpdir(), "message-tiles-")));
try {
  await waitForDebugger(globalThis.port);
  for (const scheme of ["dark", "light"]) {
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort: globalThis.port, posture, colorScheme: scheme });
      const loaded = cdp.waitForEvent("Page.loadEventFired", 20000);
      await cdp.send("Page.navigate", { url }); await loaded; await sleep(1200);
      const found = await evaluate(cdp, `(() => { const node = document.querySelector('.message-attachments'); node?.scrollIntoView({ block: 'center' }); const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }; return [r('.message-attachments'), r('.tile-strip'), r('.tile-strip-tiles'), r('.file-tile'), r('.file-tile-face')]; })()`);
      process.stdout.write(`found ${JSON.stringify(found)}\n`);
      await sleep(400);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      const path = join(out, `message-tiles-${scheme}-${posture.name}.png`);
      await writeFile(path, Buffer.from(data, "base64"));
      process.stdout.write(`captured ${path}\n`);
      cdp.close();
    }
  }
} finally { chrome.kill("SIGTERM"); }
