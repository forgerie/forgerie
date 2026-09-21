#!/usr/bin/env node
/* Report the left and right edge of every lane on a prototype page.
 *
 * Eyeballing a screenshot cannot prove alignment. A dark segment on a dark
 * row reads as absent, so a bar in the wrong place and a bar that is merely
 * faint look identical. This asks the layout instead of the pixels.
 *
 *   node prototypes/quota-shelf/measure.mjs round34 [laneSelector] [rowSelector]
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [page = "round34", laneSelector = ".k-lane", rowSelector = ".k-row"] = process.argv.slice(2);

const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
if (chromeBin === undefined) throw new Error("Chromium not found. Set CHROME_BIN or install chromium.");

const tempRoot = await mkdtemp(join(tmpdir(), "quota-measure-"));
const debugPort = await getFreePort();
const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));

const script = (laneSel, rowSel) => `
  JSON.stringify([...document.querySelectorAll(${JSON.stringify(rowSel)})].map((row) => {
    const frame = row.getBoundingClientRect();
    return {
      tag: (row.querySelector(".k-tag") || {}).textContent || "?",
      lanes: [...row.querySelectorAll(${JSON.stringify(laneSel)})].map((el) => {
        const box = el.getBoundingClientRect();
        return {
          kind: el.classList.contains("e-strip") ? "strip" : "lane",
          left: +(box.left - frame.left).toFixed(2),
          right: +(box.right - frame.left).toFixed(2),
        };
      }),
    };
  }))`;

try {
  await waitForDebugger(debugPort);
  const cdp = await openPage(debugPort);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1480, height: 1200, deviceScaleFactor: 1, mobile: false });
    const loaded = cdp.waitForEvent("Page.loadEventFired", 15000).catch(() => undefined);
    await cdp.send("Page.navigate", { url: `file://${join(here, `${page}.html`)}` });
    await loaded;
    await sleep(500);
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: script(laneSelector, rowSelector),
      returnByValue: true,
    });
    const rows = JSON.parse(result.value);

    const lefts = [];
    const rights = [];
    for (const row of rows) {
      process.stdout.write(`\n${row.tag}\n`);
      for (const lane of row.lanes) {
        process.stdout.write(`  ${lane.kind.padEnd(6)} left ${String(lane.left).padStart(8)}  right ${String(lane.right).padStart(8)}\n`);
        lefts.push(lane.left);
        rights.push(lane.right);
      }
    }
    const spread = (values) => +(Math.max(...values) - Math.min(...values)).toFixed(2);
    const dl = spread(lefts);
    const dr = spread(rights);
    process.stdout.write(`\nleft spread  ${dl} px\nright spread ${dr} px\n`);
    process.stdout.write(dl === 0 && dr === 0 ? "ALIGNED\n" : "NOT ALIGNED\n");
    process.exitCode = dl === 0 && dr === 0 ? 0 : 1;
  } finally {
    cdp.close();
  }
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(tempRoot, { recursive: true, force: true });
}
