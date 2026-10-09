#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Read-only captures of the open session picker against the live catalog.
// Opens the app at each Fold posture and scheme, plus a docked 1280 x 860
// window, opens the sheet, and saves the picker's own box as a PNG. It never
// clicks a row, so nothing is selected, sent, or written.
//   APP_URL=http://127.0.0.1:8511/ OUT=verification/local/picker-shots/after node scripts/picker-shots.mjs
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));

const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const out = process.env.OUT ?? "verification/local/picker-shots";
const scale = Number(process.env.SCALE ?? "2");
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
if (!chromeBin) throw new Error("Chromium is required");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "picker-shots-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
const postures = [...FOLD8_POSTURES, { name: "docked", width: 1280, height: 860 }];
const report = [];
try {
  await waitForDebugger(port);
  for (const scheme of schemes) {
    for (const posture of postures) {
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      const errors = [];
      cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails.text)]);
      const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
      await cdp.send("Page.navigate", { url: base });
      await loaded;
      const ready = async (predicate, what) => {
        for (let i = 0; i < 80; i += 1) { if (await evaluate(cdp, predicate)) return; await sleep(250); }
        throw new Error(`${posture.name}: ${what} never happened`);
      };
      await ready(`document.querySelectorAll(".picker-row").length > 0`, "picker rows");
      await evaluate(cdp, `(document.querySelector(".app-opener")?.getAttribute("aria-expanded") === "false" && document.querySelector(".app-opener").click(), true)`);
      await sleep(600);
      await evaluate(cdp, `Promise.all([document.fonts.load('500 13px "Public Sans Variable"'), document.fonts.load('11px "JetBrains Mono Variable"')]).then(() => document.fonts.ready).then(() => true)`);
      await sleep(200);
      const box = await evaluate(cdp, `(() => { const r = document.querySelector(".picker").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
      const overflowNodes = await evaluate(cdp, `[...document.querySelectorAll(".picker-row, .picker-group-header, .picker-more")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => ({ session: el.dataset.session, text: el.textContent, width: el.clientWidth, scrollWidth: el.scrollWidth }))`);
      const pageOverflow = await evaluate(cdp, `document.documentElement.scrollWidth > document.documentElement.clientWidth`);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: scale / 2.625 } });
      const file = join(out, `${posture.name}-${scheme}.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      report.push({ posture: posture.name, scheme, picker: `${Math.round(box.width)}x${Math.round(box.height)}`, overflow: overflowNodes.length, overflowNodes, pageOverflow, errors });
      await cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
}
console.log(JSON.stringify(report, null, 1));
