#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// Real pointer and layout checks against the production sheet's fixture boundary, never a live session.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = process.argv[2] ?? "http://localhost:8617";
const out = process.argv[3] ?? "/tmp/workflow-sheet-proof";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
const sizes = [["desktop", 1440, 900], ["fold-open", 704, 783], ["fold-open-wide", 932, 553], ["fold-cover", 475, 638], ["fold-cover-wide", 711, 374], ["tiny", 320, 320]];
const results = [];
await mkdir(out, { recursive: true });

async function pointer(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (hit !== element && !element.contains(hit)) throw new Error(`Pointer blocked for ${element.textContent}: ${hit?.outerHTML}`);
    return { x, y };
  });
  await page.mouse.click(point.x, point.y);
}
async function frame(page, state, part = "src/workflows/WorkflowSheet.organism.part.tsx") {
  await page.goto(`${origin}/__caliper/frame?part=${encodeURIComponent(part)}&state=${state}`);
  await page.locator(part.includes("StatusRow") ? ".status-row" : "dialog[open]").waitFor();
  await page.evaluate(() => document.fonts.ready);
}
try {
  for (const scheme of ["light", "dark"]) {
    for (const [name, width, height] of sizes) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await frame(page, "ProposalReview");
      assert.equal(await page.locator(".callout").count(), 2);
      assert.ok(await page.getByText("Acceptance checks", { exact: true }).count());
      const rounds = page.getByRole("spinbutton");
      assert.equal(await rounds.inputValue(), "2");
      await pointer(page, page.getByRole("button", { name: "Increase Review rounds before the run stops and reports", exact: true }));
      assert.equal(await rounds.inputValue(), "3");
      assert.equal(await page.locator(".field-edit-note").count(), 1);
      await page.screenshot({ path: `${out}/edited-${name}-${scheme}.png` });
      await pointer(page, page.getByRole("button", { name: "Use the agent's", exact: true }));
      assert.equal(await rounds.inputValue(), "2");
      assert.equal(await page.locator(".field-edit-note").count(), 0);
      await pointer(page, page.getByRole("button", { name: /^Claude Sonnet 5.*change model/ }));
      // The last result requires the model list to scroll in a short panel. A DOM click would hide a clipped list.
      await pointer(page, page.getByRole("button", { name: /Gemini 2\.5 Pro/ }));
      await page.getByText("1 model changed. The run uses it; the plan stays as it is.", { exact: true }).waitFor();
      await pointer(page, page.getByRole("button", { name: /^Gemini 2\.5 Pro.*change model/ }));
      await pointer(page, page.getByRole("button", { name: "High", exact: true }));
      await page.getByRole("button", { name: /^Gemini 2\.5 Pro High, change model/ }).waitFor();
      const fits = await page.locator("dialog.split-sheet").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
      });
      assert.ok(fits, `${name}: sheet leaves the viewport`);
      await page.locator(".split-sheet-rail").evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: `${out}/picker-${name}-${scheme}.png` });
      await page.keyboard.press("Escape");
      await page.getByText("Acceptance checks", { exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await page.locator('.split-sheet-document pre').filter({ hasText: "Acceptance checks" }).count(), 0);
      await page.screenshot({ path: `${out}/proposal-${name}-${scheme}.png` });
      assert.deepEqual(errors, []);
      results.push({ state: "ProposalReview", scheme, size: name, pointer: "last model and High", number: "increase and reset", errors });
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 711, height: 374 }, colorScheme: scheme, reducedMotion: "reduce" });
    await frame(page, "RunWorking");
    await pointer(page, page.getByRole("button", { name: "Stop the run", exact: true }));
    await page.screenshot({ path: `${out}/stop-confirm-${scheme}.png` });
    await pointer(page, page.getByRole("button", { name: "Stop now", exact: true }));
    await page.getByText("Stopped by the user. Files and commits were kept.", { exact: true }).waitFor();
    await page.screenshot({ path: `${out}/stopped-${scheme}.png` });
    results.push({ state: "RunWorking", scheme, stop: "confirmed and finished" });
    await frame(page, "default", "src/ui/StatusRow.molecule.part.tsx");
    assert.equal(await page.locator(".status-row").evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
    await page.screenshot({ path: `${out}/waiting-row-${scheme}.png` });
    results.push({ state: "StatusRow", scheme, background: "transparent" });
    await page.close();
  }
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
