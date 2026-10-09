#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Rich blocks in the network-free preview: every Fold posture, both schemes.
// Captures each block in view, checks layout invariants, and streams the
// reply live to prove nothing throws while blocks are half-written.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const profile = await mkdtemp(join(tmpdir(), "aui-rich-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(chromeBin, "Chromium is required");
const chrome = launchChrome(chromeBin, port, profile);
const base = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const output = resolve("verification/local/rich-blocks");
const result = { postures: [], errors: [] };
await mkdir(join(output, "shots"), { recursive: true });

async function until(cdp, expression, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await sleep(30);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function shot(cdp, name) {
  await sleep(150);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "shots", `${name}.png`), Buffer.from(data, "base64"));
}

try {
  await waitForDebugger(port);
  for (const scheme of ["light", "dark"]) {
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(`${posture.name}: ${event.exceptionDetails.text}`)]);
      try {
        const label = `${posture.name}-${scheme}`;
        await cdp.send("Page.navigate", { url: new URL("/verification/preview.html?scenario=rich-blocks", base).href });
        await until(cdp, `document.querySelectorAll('.rich-option').length === 2`);
        const metrics = await evaluate(cdp, `(() => {
          const options = [...document.querySelectorAll('.rich-option')].map((node) => node.getBoundingClientRect());
          const steps = [...document.querySelectorAll('.rich-step')];
          return {
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            column: Math.round(document.querySelector('.rich-compare-options').getBoundingClientRect().width),
            optionsInOneRow: options.every((rect) => Math.abs(rect.top - options[0].top) < 1),
            optionsStacked: options.every((rect, index) => index === 0 || rect.top > options[index - 1].top),
            steps: steps.length,
            stepNumbers: steps.map((step) => getComputedStyle(step, '::before').content),
            callouts: [...document.querySelectorAll('.callout')].map((node) => node.dataset.callout),
          };
        })()`);
        assert.equal(metrics.pageOverflow, false, `${label}: page overflows`);
        // Exactly one of the two arrangements: never a lone option on a second row.
        assert.ok(metrics.optionsInOneRow !== metrics.optionsStacked, `${label}: options split across rows`);
        assert.deepEqual(metrics.callouts, ["warning", "tip"]);
        assert.equal(metrics.steps, 4);
        result.postures.push({ scheme, posture: posture.name, ...metrics });
        for (const [name, selector] of [["callout", ".callout"], ["steps", ".rich-steps"], ["compare", ".rich-compare"]]) {
          await evaluate(cdp, `document.querySelector('${selector}').scrollIntoView({ block: 'start' })`);
          await shot(cdp, `${label}-${name}`);
        }
        // Mid-stream frame: a comparison that has only part of its first option.
        await cdp.send("Page.navigate", { url: new URL("/verification/preview.html?scenario=rich-blocks-running", base).href });
        await until(cdp, `document.querySelectorAll('.rich-option').length === 1`);
        await evaluate(cdp, `document.querySelector('.rich-compare').scrollIntoView({ block: 'start' })`);
        await shot(cdp, `${label}-running`);
        if (posture === FOLD8_POSTURES[0]) {
          // Stream the whole reply in 6-character chunks; it must end complete.
          await cdp.send("Page.navigate", { url: new URL("/verification/preview.html?scenario=rich-blocks-live", base).href });
          await until(cdp, `document.querySelector('.markdown')?.dataset.status === 'complete' && document.querySelectorAll('.rich-option').length === 2`, 30_000);
          assert.equal(await evaluate(cdp, `document.querySelectorAll('.callout-label').length`), 2);
        }
      } finally { cdp.close(); }
    }
  }
  assert.deepEqual(result.errors, []);
  await writeFile(join(output, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.postures.map(({ scheme, posture, column, optionsInOneRow }) => ({ scheme, posture, column, optionsInOneRow }))));
} finally {
  chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
