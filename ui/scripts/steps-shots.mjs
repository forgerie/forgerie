#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Captures the `steps` preview at every Fold posture and both colour schemes:
// the top of the turn with the failed step open, and the live turn. Run from
// ui/ with the dev server up: APP_URL=http://127.0.0.1:8519/ scripts/steps-shots.mjs
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const out = resolve(process.env.OUT ?? "/tmp/steps-shots");
const base = process.env.APP_URL ?? "http://127.0.0.1:8519/";
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "steps-shots-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
// Opens the first step with a failure, then scrolls the turn to its top.
const prepare = (open) => `(() => {
  if (${open}) [...document.querySelectorAll(".tally")].find((row) => row.querySelector('.tally-mark[data-tone="bad"]'))?.querySelector("button.tally-toggle")?.click();
  return true;
})()`;
const top = (toTop) => `(() => { const t = document.querySelector(".transcript"); t.scrollTop = ${toTop} ? 0 : t.scrollHeight; return {
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  rows: document.querySelectorAll(".tally").length } })()`;
try {
  await waitForDebugger(port);
  for (const [scenario, open] of [["steps", true], ["steps-running", false]]) {
    for (const colorScheme of ["dark", "light"]) {
      for (const posture of FOLD8_POSTURES) {
        const cdp = await openPosturePage({ debugPort: port, posture, colorScheme });
        await cdp.send("Page.navigate", { url: new URL(`/verification/preview.html?scenario=${scenario}`, base).href });
        const deadline = Date.now() + 10_000;
        while (!(await evaluate(cdp, `document.querySelectorAll(".tally").length > 0`))) {
          if (Date.now() > deadline) throw new Error(`No step rows in ${scenario}`);
          await sleep(50);
        }
        await sleep(600);
        await evaluate(cdp, prepare(open));
        await sleep(300);
        const facts = await evaluate(cdp, top(open));
        await sleep(300);
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `${scenario}-${colorScheme}-${posture.name}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        console.log(file, JSON.stringify(facts));
        cdp.close();
      }
    }
  }
} finally {
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 });
}
