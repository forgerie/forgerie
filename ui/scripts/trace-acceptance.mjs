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
// Opens every activity fold, then the failed and the last tool card.
const openAll = `(() => {
  const open = (details) => { details.open = true; };
  document.querySelectorAll("details.chain-of-thought").forEach(open);
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
  for (const scenario of ["tools", "tools-running", "chain-of-thought", "chain-of-thought-running"]) {
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
        const initial = await evaluate(cdp, `(() => {
          const groups = [...document.querySelectorAll("details.chain-of-thought")];
          return {
            count: groups.length,
            closed: groups.every((node) => !node.open),
            noOutput: !document.querySelector(".trace-pre"),
            failedOnParent: groups.some((node) => node.dataset.tone === "error" && node.querySelector(":scope > summary .trace-label").textContent.includes("1 failed")),
            answerOutside: [...document.querySelectorAll(".message-text > .markdown")].some((node) => node.textContent.includes("The suite passed.")),
            nestedFolds: document.querySelectorAll("details.chain-of-thought details:not(.tool-call)").length,
          };
        })()`);
        assert.ok(initial.closed && initial.noOutput, "Activity is collapsed and output is lazy");
        assert.equal(initial.nestedFolds, 0, "No fold opens only to show another fold");
        assert.ok(initial.failedOnParent, "A collapsed group exposes its failed call");
        if (scenario.startsWith("chain-of-thought")) {
          assert.equal(initial.count, 1, "Alternating reasoning and tools share one section");
          assert.equal(initial.answerOutside, scenario === "chain-of-thought", "Final text stays outside activity");
          const closedShot = await cdp.send("Page.captureScreenshot", { format: "png" });
          await writeFile(join(out, `${scenario}-${colorScheme}-${posture.name}-closed.png`), Buffer.from(closedShot.data, "base64"));
        }
        // Exercise the native summary's real keyboard behavior, not just its attribute.
        await evaluate(cdp, `document.querySelector("details.chain-of-thought[data-tone=error] > summary").focus()`);
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        const toggleDeadline = Date.now() + 2_000;
        while (!(await evaluate(cdp, `document.querySelector("details.chain-of-thought[data-tone=error]").open`))) {
          if (Date.now() >= toggleDeadline) {
            const focus = await evaluate(cdp, `({ active: document.activeElement?.outerHTML, focused: document.hasFocus() })`);
            throw new Error(`Enter did not open the activity summary: ${JSON.stringify(focus)}`);
          }
          await sleep(20);
        }
        await evaluate(cdp, openAll);
        await sleep(300);
        if (scenario === "chain-of-thought-running") {
          await evaluate(cdp, `document.querySelector(".transcript").scrollTop = 0`);
          const topShot = await cdp.send("Page.captureScreenshot", { format: "png" });
          await writeFile(join(out, `${scenario}-${colorScheme}-${posture.name}-steps.png`), Buffer.from(topShot.data, "base64"));
        }
        // Show the first opened failure, where the densest content sits.
        await evaluate(cdp, `(document.querySelector("details.tool-call[data-tone=error]") ?? document.querySelector("details.tool-call[open]"))?.scrollIntoView({ block: "start" }) ?? true`);
        await sleep(200);
        const metrics = await evaluate(cdp, measure);
        const name = `${scenario}-${colorScheme}-${posture.name ?? `${posture.width}x${posture.height}`}.png`;
        const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(out, name), Buffer.from(shot.data, "base64"));
        results.push({ scenario, colorScheme, posture: `${posture.width}x${posture.height}`, initial, ...metrics, errors });
        cdp.close?.();
      }
    }
  }
} finally {
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
const failures = results.filter((r) => r.pageOverflow || r.summaryOverflow || !r.presWithinColumn || r.minSummaryHeight < 28 || r.errors.length > 0);
console.log(JSON.stringify({ captures: results.length, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
