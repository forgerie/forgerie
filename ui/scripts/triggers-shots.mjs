#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Capture the triggers screen on fixture data (verification/triggers-preview.html) at the brief's five sizes (the
// four Galaxy Z Fold 8 postures plus a split pane of half the unfolded screen), the tiny pane, and for some shots
// two desktop sizes, in both colour schemes.
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
const FOLD = [...FOLD8_POSTURES, { name: "split-pane", width: 352, height: 783 }, { name: "tiny-pane", width: 280, height: 600 }];
const DESKTOP = [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "desktop-1024", width: 1024, height: 768 }];
const SIZES = [...FOLD, ...DESKTOP].filter((size) => !process.env.SIZES || process.env.SIZES.split(" ").includes(size.name));
const out = resolve(process.env.SHOT_DIR ?? "/tmp/forgerie-triggers-shots");
const base = new URL("/verification/triggers-preview.html", process.env.APP_URL ?? "http://127.0.0.1:8510/");
const DPR = Number(process.env.DPR ?? 1);

/** The first visible button whose accessible name or text is `match` (a string), or starts with it (`{ prefix }`). */
const find = (match) => `[...document.querySelectorAll("button")].find((node) => {
  if (node.getClientRects().length === 0) return false;
  const name = node.getAttribute("aria-label") ?? node.textContent ?? "";
  const want = ${JSON.stringify(match)};
  return typeof want === "string" ? name === want || node.textContent === want : name.startsWith(want.prefix);
})`;
// Scroll the button to the middle of its scroller first, then wait for the scroll to settle: a window-level menu
// closes on a scroll under it, so the click comes after.
const click = (match) => `(async () => {
  const target = ${find(match)};
  if (!target) return false;
  target.scrollIntoView({ block: "center" });
  await new Promise((done) => setTimeout(done, 300));
  target.click();
  return true;
})()`;
// The header's primary action: on the header while it has room, else first in its ⋯ menu.
const primary = (label) => `(async () => {
  if (${find(label)}) return ${click(label)};
  if (!(await ${click("Trigger commands")})) return false;
  await new Promise((done) => setTimeout(done, 300));
  return ${click(label)};
})()`;
const reveal = (match) => `(() => { const target = ${find(match)}; if (!target) return false; target.scrollIntoView({ block: "center" }); return true; })()`;
const scrollEnd = `(() => { const region = document.querySelector(".settings-scroll"); if (!region) return false; region.scrollTop = region.scrollHeight; return true; })()`;
const typeInto = (label, text) => `(() => {
  const input = document.querySelector(${JSON.stringify(`input[aria-label="${label}"]`)});
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;
const closeGroup = (label) => `(() => {
  const toggle = [...document.querySelectorAll(".record-group-toggle")].find((node) => node.querySelector(".record-group-label")?.textContent === ${JSON.stringify(label)});
  if (!toggle) return false;
  toggle.click();
  return true;
})()`;
const TRIGGERS = `!!document.querySelector(".settings-shell") && !document.querySelector(".loading-lines")`;
// The session shots wait for the first trigger read to light the opener's dot.
const SESSION = `!!document.querySelector(".app-opener[data-attention]")`;
/**
 * Each shot: the preview state, steps that reach the surface under test, and when the page is ready. `desktop` also
 * takes the shot at the two desktop sizes; every shot runs at the Fold's four postures, the split pane, and the tiny pane.
 */
const SHOTS = {
  list: { state: "list", desktop: true },
  empty: { state: "empty", desktop: true },
  failed: { state: "failed", desktop: true },
  "failed-runs": { state: "failed", steps: [scrollEnd] },
  trigger: { state: "paused" },
  "trigger-form": { state: "paused", steps: [scrollEnd] },
  create: { state: "create", desktop: true },
  "create-problems": { state: "create", steps: [primary("Create")] },
  missed: { state: "missed" },
  off: { state: "off" },
  many: { state: "many" },
  "run-dialog": { state: "failed", steps: [click("Run now…")] },
  "row-menu": { state: "list", steps: [click("Commands for Docs sweep")] },
  "header-menu": { state: "list", steps: [click("Trigger commands")] },
  footer: { state: "list", sheet: true, desktop: true },
  // The Fold's morning path: a session is open, the list is closed, and the opener's dot is the only sign.
  morning: { state: "list", view: "session", ready: SESSION },
  "off-dot": { state: "off", view: "session", ready: SESSION },
  "footer-off": { state: "off", sheet: true },
  "picker-menu": { state: "list", sheet: true, steps: [click("More session commands")] },
  loading: { state: "loading", ready: `!!document.querySelector(".loading-lines")` },
  "read-failed": { state: "failed-read" },
  unknown: { state: "unknown" },
  conflict: { state: "conflict" },
  edited: { state: "edited" },
  "edited-menu": { state: "edited", steps: [click("Trigger commands")] },
  "leave-dialog": { state: "edited", steps: [click("Triggers")] },
  "delete-dialog": { state: "paused", steps: [click("Trigger commands"), click("Delete trigger…")] },
  "delete-toast": { state: "paused", steps: [click("Trigger commands"), click("Delete trigger…"), click("Delete trigger")] },
  "run-toast": { state: "failed", steps: [click("Run now…"), click("Run now")] },
  "days-problem": { state: "days-problem", steps: [primary("Create")] },
  "workflow-picker": { state: "create-in-project", steps: [click({ prefix: "Workflow:" })] },
  "zone-picker": { state: "create-in-project", steps: [click({ prefix: "Time zone:" })] },
  "input-problem": { state: "input-problem", steps: [primary("Create")] },
  "show-all": { state: "long", steps: [reveal("Show all 50")] },
  "filter-none": { state: "many", steps: [typeInto("Filter by name, project, or workflow", "zzz")] },
  "groups-collapsed": { state: "many", steps: [closeGroup("Active"), closeGroup("Paused")] },
  "agent-row-menu": { state: "list", steps: [click("Commands for Dependency audit")] },
  // The last row's menu: under the button when it fits, above it, or wherever the window has room.
  "bottom-row-menu": { state: "list", steps: [click("Commands for Docs sweep")] },
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
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: DPR, mobile: !DESKTOP.includes(size) });
      for (const name of names) {
        const shot = SHOTS[name];
        if (!shot) throw new Error(`Unknown shot ${name}`);
        if (DESKTOP.includes(size) && !shot.desktop) continue;
        const url = new URL(base);
        url.searchParams.set("state", shot.state);
        if (shot.sheet) url.searchParams.set("sheet", "open");
        if (shot.view) url.searchParams.set("view", shot.view);
        await cdp.send("Page.navigate", { url: url.href });
        let ready = false;
        for (let index = 0; index < 200 && !ready; index++) {
          ready = await evaluate(cdp, shot.ready ?? TRIGGERS);
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
