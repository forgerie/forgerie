#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Opens reasoning, tool groups, and tool cards in the fixture entry point at
// every Fold posture and color scheme, checks layout, and saves screenshots.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve(process.env.OUT ?? "verification/local/trace-shots");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-trace-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(chromeBin, "Chromium is required");
const chrome = launchChrome(chromeBin, port, profile);
const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const results = [];
// Opens every group and reasoning block, then the failed and the last tool card.
const openAll = `(() => {
  const open = (details) => { details.open = true; };
  document.querySelectorAll("details.reasoning, details.tool-group").forEach(open);
  const cards = [...document.querySelectorAll("details.tool-call")];
  cards.filter((card) => card.dataset.tone === "error").forEach(open);
  if (cards.at(-1)) open(cards.at(-1));
  return true;
})()`;
const measure = `(() => {
  const summaries = [...document.querySelectorAll("summary.trace-line")];
  const pres = [...document.querySelectorAll(".trace-pre")];
  return {
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    summaries: summaries.length,
    minSummaryHeight: Math.min(...summaries.map((node) => node.getBoundingClientRect().height)),
    summaryOverflow: summaries.some((node) => node.scrollWidth > node.clientWidth + 1),
    openPres: pres.length,
    presWithinColumn: pres.every((node) => node.getBoundingClientRect().right <= document.querySelector(".thread-column").getBoundingClientRect().right + 1),
    tallestPre: Math.max(0, ...pres.map((node) => node.getBoundingClientRect().height)),
    viewportHeight: innerHeight,
    liveLines: document.querySelectorAll(".trace-text[data-live]").length,
  };
})()`;
try {
  await waitForDebugger(port);
  for (const scenario of ["tools", "tools-running"]) {
    for (const colorScheme of ["dark", "light"]) {
      for (const posture of FOLD8_POSTURES) {
        const cdp = await openPosturePage({ debugPort: port, posture, colorScheme });
        const errors = [];
        cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails.text)]);
        await cdp.send("Page.navigate", { url: new URL(`/verification/preview.html?scenario=${scenario}`, base).href });
        const deadline = Date.now() + 10_000;
        while (!(await evaluate(cdp, `document.querySelectorAll("details.tool-call").length > 0`))) {
          if (Date.now() > deadline) throw new Error(`No tool cards in ${scenario}`);
          await sleep(50);
        }
        await evaluate(cdp, `document.fonts.ready.then(() => true)`);
        await evaluate(cdp, openAll);
        await sleep(300);
        // Show the first opened failure, where the densest content sits.
        await evaluate(cdp, `(document.querySelector("details.tool-call[data-tone=error]") ?? document.querySelector("details.tool-call[open]"))?.scrollIntoView({ block: "start" }) ?? true`);
        await sleep(200);
        const metrics = await evaluate(cdp, measure);
        const name = `${scenario}-${colorScheme}-${posture.name ?? `${posture.width}x${posture.height}`}.png`;
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(out, name), Buffer.from(shot.data, "base64"));
        results.push({ scenario, colorScheme, posture: `${posture.width}x${posture.height}`, ...metrics, errors });
        cdp.close?.();
      }
    }
  }
} finally {
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
const failures = results.filter((r) => r.pageOverflow || r.summaryOverflow || !r.presWithinColumn || r.minSummaryHeight < 32 || r.errors.length > 0);
console.log(JSON.stringify({ captures: results.length, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
