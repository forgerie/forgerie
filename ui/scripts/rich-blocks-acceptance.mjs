#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
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
const result = { postures: [], report: [], answer: [], errors: [] };
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
        // Round two: a report with facts, status, files and a real Mermaid diagram.
        await cdp.send("Page.navigate", { url: new URL("/verification/preview.html?scenario=rich-report", base).href });
        await until(cdp, `document.querySelector('.diagram')?.dataset.drawing === 'drawn'`, 20_000);
        const report = await evaluate(cdp, `(() => {
          const canvas = document.querySelector('.diagram-canvas');
          const svg = canvas.querySelector('svg');
          const cells = [...document.querySelectorAll('.fact-list-cell')].map((cell) => cell.getBoundingClientRect());
          const rows = new Set(cells.map((rect) => Math.round(rect.top))).size;
          return {
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            factRows: rows,
            factMinWidth: Math.round(Math.min(...cells.map((rect) => rect.width))),
            checklist: [...document.querySelectorAll('.checklist-item')].map((item) => item.dataset.state).join(','),
            summary: document.querySelector('.checklist-summary').textContent,
            files: document.querySelectorAll('.path-tree-name').length,
            diagramScale: Math.round(svg.getBoundingClientRect().width / Number(canvas.style.getPropertyValue('--diagram-width').replace('px', '')) * 100) / 100,
            diagramScrolls: canvas.scrollWidth > canvas.clientWidth,
            svgFill: getComputedStyle(svg.querySelector('rect.actor, rect') ?? svg).fill,
          };
        })()`);
        assert.equal(report.pageOverflow, false, `${label}: report page overflows`);
        assert.equal(report.checklist, "done,done,active,failed,todo");
        assert.equal(report.summary, "2 of 5 done, 1 failed, 1 in progress");
        assert.ok(report.factMinWidth >= 120, `${label}: fact cells too narrow (${report.factMinWidth})`);
        assert.ok(report.diagramScale >= 0.6, `${label}: diagram shrank below its minimum scale (${report.diagramScale})`);
        result.report.push({ scheme, posture: posture.name, ...report });
        for (const [name, selector] of [["facts", ".fact-list"], ["status", ".checklist"], ["files", ".path-tree"], ["diagram", ".diagram"]]) {
          await evaluate(cdp, `document.querySelector('${selector}').scrollIntoView({ block: 'start' })`);
          await shot(cdp, `${label}-${name}`);
        }
        // Round three: claims, commands, bars and details.
        await cdp.send("Page.navigate", { url: new URL("/verification/preview.html?scenario=rich-answer", base).href });
        await until(cdp, `document.querySelectorAll('.bar-chart-bar').length === 3`);
        const answer = await evaluate(cdp, `(() => {
          const bars = [...document.querySelectorAll('.bar-chart-bar')].map((bar) => bar.getBoundingClientRect().width);
          const tracks = [...document.querySelectorAll('.bar-chart-track')].map((track) => Math.round(track.getBoundingClientRect().left));
          const badges = [...document.querySelectorAll('.claim-list-badge')].map((badge) => Math.round(badge.getBoundingClientRect().width));
          const summary = document.querySelector('.disclosure-summary').getBoundingClientRect();
          return {
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            barRatios: bars.map((width) => Math.round(width / bars[2] * 100) / 100),
            tracksAligned: new Set(tracks).size === 1,
            badgeWidth: Math.min(...badges),
            claimsWrapped: [...document.querySelectorAll('.claim-list-item')].some((item) => item.querySelector('.claim-list-body').getBoundingClientRect().top > item.querySelector('.claim-list-badge').getBoundingClientRect().bottom),
            summaryHeight: Math.round(summary.height),
            detailsOpen: document.querySelector('details.disclosure').open,
            copyButtons: document.querySelectorAll('.command-list button').length,
          };
        })()`);
        assert.equal(answer.pageOverflow, false, `${label}: answer page overflows`);
        assert.ok(Math.abs(answer.barRatios[0] - 0.43) < 0.03 && Math.abs(answer.barRatios[1] - 0.65) < 0.03, `${label}: bars not to scale ${answer.barRatios}`);
        assert.equal(answer.tracksAligned, true, `${label}: bar tracks do not line up`);
        assert.ok(answer.summaryHeight >= 44, `${label}: details summary below the touch size (${answer.summaryHeight})`);
        assert.equal(answer.detailsOpen, false);
        assert.equal(answer.copyButtons, 3);
        result.answer.push({ scheme, posture: posture.name, ...answer });
        for (const [name, selector] of [["claims", ".claim-list"], ["commands", ".command-list"], ["bars", ".bar-chart"]]) {
          await evaluate(cdp, `document.querySelector('${selector}').scrollIntoView({ block: 'start' })`);
          await shot(cdp, `${label}-${name}`);
        }
        await evaluate(cdp, `document.querySelector('.disclosure-summary').click(); document.querySelector('.disclosure').scrollIntoView({ block: 'start' })`);
        await shot(cdp, `${label}-details-open`);
        if (posture === FOLD8_POSTURES[0]) {
          await cdp.send("Page.navigate", { url: new URL("/verification/preview.html?scenario=rich-answer-live", base).href });
          await until(cdp, `document.querySelector('.markdown')?.dataset.status === 'complete' && document.querySelectorAll('.bar-chart-bar').length === 3`, 40_000);
        }
        if (posture === FOLD8_POSTURES[0]) {
          await cdp.send("Page.navigate", { url: new URL("/verification/preview.html?scenario=rich-report-live", base).href });
          await until(cdp, `document.querySelector('.markdown')?.dataset.status === 'complete' && document.querySelector('.diagram')?.dataset.drawing === 'drawn'`, 40_000);
          assert.equal(await evaluate(cdp, `document.querySelectorAll('.diagram').length`), 1);
        }
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
  console.log(JSON.stringify(result.answer));
} finally {
  chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
