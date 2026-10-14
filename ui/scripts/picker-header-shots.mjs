#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Captures the session list's header with search closed and open, and measures it.
// For each width and scheme it opens the sheet, saves the picker's box as a PNG,
// then opens search (the Search button), types QUERY, and saves it again. It reports
// the header's height in each state, the room above the first row, each header
// icon's box, and whether any two 44px hit areas overlap. Run against the search
// fixture (verification/README.md, "Session search"), which serves fixture sessions only.
//   APP_URL=http://127.0.0.1:8571/ OUT=/tmp/picker-header node scripts/picker-header-shots.mjs
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));

const base = process.env.APP_URL ?? "http://127.0.0.1:8571/";
const out = process.env.OUT ?? "verification/local/picker-header";
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const states = (process.env.STATES ?? "closed,open,typed").split(",");
const query = process.env.QUERY ?? "de";
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
if (!chromeBin) throw new Error("Chromium is required");
// A phone (the reported screenshot's class), the narrowest phone sheet, the narrowest docked list, and a desktop.
const sizes = (process.env.SIZES ?? "phone:412x915,small-phone:320x640,docked-narrow:1000x700,desktop:1280x860").split(",").map((entry) => {
  const [name, size] = entry.split(":");
  const [width, height] = size.split("x").map(Number);
  return { name, width, height };
});
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "picker-header-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
const MEASURE = `(() => {
  const picker = document.querySelector(".picker").getBoundingClientRect();
  const header = document.querySelector(".picker-header").getBoundingClientRect();
  const first = document.querySelector(".picker-row, .hit-row, .picker-state")?.getBoundingClientRect();
  const icons = [...document.querySelectorAll(".picker-header > .picker-icon")].map((el) => {
    const r = el.getBoundingClientRect();
    return { label: el.getAttribute("aria-label"), x: Math.round(r.x - picker.x), width: Math.round(r.width), centre: r.x + r.width / 2 };
  });
  const hit = 44;
  const overlaps = icons.slice(1).filter((icon, index) => icon.centre - icons[index].centre < hit - 0.5).map((icon) => icon.label);
  const name = document.querySelector(".picker-brand-name");
  return {
    picker: Math.round(picker.width) + "x" + Math.round(picker.height),
    header: Math.round(header.height),
    listTop: Math.round(document.querySelector(".picker-room").getBoundingClientRect().top - picker.top),
    firstRowTop: first ? Math.round(first.top - picker.top) : null,
    icons: icons.map(({ label, x, width }) => label + "@" + x + "/" + width),
    hitOverlaps: overlaps,
    nameTruncated: name ? name.scrollWidth > name.clientWidth : null,
    focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.className ?? null,
  };
})()`;
const report = [];
try {
  await waitForDebugger(port);
  for (const scheme of schemes) {
    for (const size of sizes) {
      const cdp = await openPosturePage({ debugPort: port, posture: size, colorScheme: scheme });
      const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
      // A selected session, so the overlay list carries its × as it does in use.
      await cdp.send("Page.navigate", { url: `${base}?session=s-deploy` });
      await loaded;
      const ready = async (predicate, what) => {
        for (let i = 0; i < 80; i += 1) { if (await evaluate(cdp, predicate)) return; await sleep(250); }
        throw new Error(`${size.name}: ${what} never happened`);
      };
      await ready(`document.querySelectorAll(".picker-row").length > 0`, "picker rows");
      await evaluate(cdp, `(document.querySelector(".app-opener")?.getAttribute("aria-expanded") === "false" && document.querySelector(".app-opener").click(), true)`);
      await sleep(600);
      await evaluate(cdp, `Promise.all([document.fonts.load('500 13px "Public Sans Variable"'), document.fonts.load('11px "JetBrains Mono Variable"')]).then(() => document.fonts.ready).then(() => true)`);
      await sleep(200);
      for (const state of states) {
        if (state === "open" || state === "typed") {
          await evaluate(cdp, `(document.querySelector('.picker-header button[aria-label="Search sessions"]')?.click(), true)`);
          await sleep(300);
        }
        if (state === "typed") {
          await evaluate(cdp, `(() => { const input = document.querySelector('input[aria-label="Search sessions"]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(query)});
            input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
          await sleep(900);
        }
        const box = await evaluate(cdp, `(() => { const r = document.querySelector(".picker").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 520) }; })()`);
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 / 2.625 } });
        const file = join(out, `${size.name}-${state}-${scheme}.png`);
        await writeFile(file, Buffer.from(shot.data, "base64"));
        report.push({ size: size.name, viewport: `${size.width}x${size.height}`, state, scheme, ...await evaluate(cdp, MEASURE), file });
      }
      await cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
}
console.log(JSON.stringify(report, null, 1));
