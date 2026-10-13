#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Capture the triggers screen on fixture data (verification/triggers-preview.html) at the brief's five sizes, the
// four Galaxy Z Fold 8 postures plus a split pane of half the unfolded screen, in both colour schemes.
// Requires the dev server: APP_URL (default http://127.0.0.1:8510/). The fixture clock is the evening of Oct 12 2026 in Denver.
//   SHOTS="list failed" SIZES="split-pane" ui/scripts/triggers-shots.mjs
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.env.FORGERIE_ROOT ?? resolve(new URL("../..", import.meta.url).pathname);
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep, openPage } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const SIZES = [...FOLD8_POSTURES, { name: "split-pane", width: 352, height: 783 }]
  .filter((size) => !process.env.SIZES || process.env.SIZES.split(" ").includes(size.name));
const out = resolve(process.env.SHOT_DIR ?? "/tmp/forgerie-triggers-shots");
const base = new URL("/verification/triggers-preview.html", process.env.APP_URL ?? "http://127.0.0.1:8510/");
const DPR = Number(process.env.DPR ?? 1);

const click = (match) => `(() => {
  const target = [...document.querySelectorAll("button")].find((node) => node.getClientRects().length > 0
    && ((node.getAttribute("aria-label") ?? "") === ${JSON.stringify(match)} || node.textContent === ${JSON.stringify(match)}));
  if (!target) return false;
  target.click();
  return true;
})()`;
const scrollEnd = `(() => { const region = document.querySelector(".settings-scroll"); if (!region) return false; region.scrollTop = region.scrollHeight; return true; })()`;
/** Each shot: the preview state, then steps that reach the surface under test. */
const SHOTS = {
  list: { state: "list" },
  empty: { state: "empty" },
  failed: { state: "failed" },
  "failed-runs": { state: "failed", steps: [scrollEnd] },
  trigger: { state: "paused" },
  "trigger-form": { state: "paused", steps: [scrollEnd] },
  create: { state: "create" },
  "create-problems": { state: "create", steps: [click("Create")] },
  missed: { state: "missed" },
  off: { state: "off" },
  many: { state: "many" },
  "run-dialog": { state: "failed", steps: [click("Run now…")] },
  "row-menu": { state: "list", steps: [click("Commands for Docs sweep")] },
  footer: { state: "list", sheet: true },
};
const names = (process.env.SHOTS ?? Object.keys(SHOTS).join(" ")).split(" ").filter(Boolean);

await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-triggers-"));
const port = await getFreePort();
const chrome = launchChrome(process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim(), port, profile);
let cdp;
const problems = [];
try {
  await waitForDebugger(port);
  cdp = await openPage(port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "America/Denver" });
  for (const scheme of (process.env.SCHEMES ?? "light dark").split(" ")) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const size of SIZES) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: DPR, mobile: true });
      for (const name of names) {
        const shot = SHOTS[name];
        if (!shot) throw new Error(`Unknown shot ${name}`);
        const url = new URL(base);
        url.searchParams.set("state", shot.state);
        if (shot.sheet) url.searchParams.set("sheet", "open");
        await cdp.send("Page.navigate", { url: url.href });
        let ready = false;
        for (let index = 0; index < 200 && !ready; index++) {
          ready = await evaluate(cdp, `!!document.querySelector(".settings-shell") && !document.querySelector(".loading-lines")`);
          if (!ready) await sleep(50);
        }
        await evaluate(cdp, `document.fonts.ready.then(() => true)`);
        await sleep(500);
        for (const step of shot.steps ?? []) {
          if (!(await evaluate(cdp, step))) problems.push(`${name} ${scheme} ${size.name}: a step found nothing`);
          await sleep(500);
        }
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = join(out, `${name}.${scheme}.${size.name}.png`);
        await writeFile(file, Buffer.from(data, "base64"));
        console.log("captured", file);
      }
    }
  }
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; }
