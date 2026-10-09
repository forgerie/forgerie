#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium --command node
// Run from ui/ with the dev server up. Uses the canonical posture harness,
// fixture data, and the production Thread. Does not prompt any live session.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } from "../../scripts/lib/cdp.mjs";
import { openPosturePage } from "../../scripts/lib/posture-page.mjs";
import { FOLD8_POSTURES, FOLD8_DPR } from "../../scripts/lib/fold8-postures.mjs";

const base = process.env.APP_URL ?? "http://127.0.0.1:8527/";
const out = process.env.OUT ?? "/tmp/terminal-response-shots";
const chromeBin = process.env.CHROME_BIN ?? spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
assert.ok(chromeBin, "Chromium is required");
const profile = await mkdtemp(join(tmpdir(), "terminal-response-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
const results = [];
await mkdir(out, { recursive: true });

const measure = `(() => {
  const heading = document.querySelector('.message-assistant h2');
  const rows = [...document.querySelectorAll('.tally')];
  const folds = [...document.querySelectorAll('details.chain-of-thought')];
  return {
    responseOutsideWork: heading?.textContent === 'Recommendation' && !heading.closest('.rail-section, .tally, details'),
    responseVisible: heading?.checkVisibility() === true,
    normalResponseSize: heading?.closest('.markdown')?.parentElement?.className === 'message-text',
    workClosed: rows.length === 1 && rows[0].querySelector('.tally-toggle').getAttribute('aria-expanded') === 'false',
    thinkingClosed: folds.length > 0 && folds.every(fold => !fold.open),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    question: document.querySelector('.ask-question')?.textContent ?? null,
    draft: document.querySelector('[aria-label="Message"]')?.value,
    width: innerWidth, height: innerHeight,
  };
})()`;

try {
  await waitForDebugger(port);
  for (const scenario of ["terminal-ask", "terminal-reply"]) {
    for (const colorScheme of ["dark", "light"]) {
      const cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[0], colorScheme });
      const errors = [];
      cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails.text)]);
      try {
        await cdp.send("Page.navigate", { url: new URL(`/verification/preview.html?scenario=${scenario}`, base).href });
        const deadline = Date.now() + 20_000;
        while (!(await evaluate(cdp, "document.querySelector('.message-assistant h2')?.textContent === 'Recommendation'"))) {
          if (Date.now() > deadline) throw new Error(`No response rendered in ${scenario}`);
          await sleep(100);
        }
        await evaluate(cdp, "document.fonts.ready.then(() => true)");
        await evaluate(cdp, "document.querySelector('[aria-label=Message]').focus()");
        await cdp.send("Input.insertText", { text: "Keep this draft" });
        for (const posture of FOLD8_POSTURES) {
          // Resize the same page to verify draft and disclosure state survive rotation and folding.
          await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height,
            deviceScaleFactor: FOLD8_DPR, mobile: true });
          await evaluate(cdp, "document.querySelector('.message-assistant h2').scrollIntoView({ block: 'start' })");
          await sleep(300);
          const facts = await evaluate(cdp, measure);
          assert.equal(facts.responseOutsideWork, true, "Response is not work narration");
          assert.equal(facts.responseVisible, true, "Response is not hidden in a closed disclosure");
          assert.equal(facts.normalResponseSize, true, "Response uses normal prose, not muted rail text");
          assert.equal(facts.workClosed, true, "Ordinary work stays collapsed");
          assert.equal(facts.thinkingClosed, true, "Thinking stays collapsed");
          assert.equal(facts.overflow, false, "No horizontal page overflow");
          assert.equal(facts.question, scenario === "terminal-ask" ? "Which update policy should I use?" : null);
          assert.equal(facts.draft, "Keep this draft", "Resize keeps the draft");
          assert.equal(facts.width, posture.width);
          assert.equal(facts.height, posture.height);
          assert.deepEqual(errors, [], "No browser exceptions");
          const file = join(out, `${scenario}-${colorScheme}-${posture.name}.png`);
          const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          await writeFile(file, Buffer.from(shot.data, "base64"));
          results.push({ scenario, colorScheme, posture: posture.name, file, ...facts });
          console.log(`PASS ${scenario} ${colorScheme} ${posture.name}`);
        }
      } finally { cdp.close(); }
    }
  }
  await writeFile(join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${results.length} posture/theme/scenario checks passed. Evidence: ${out}`);
} finally {
  chrome.kill("SIGTERM");
  await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
