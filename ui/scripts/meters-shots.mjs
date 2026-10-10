#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Read-only captures of the account meters at the foot of the open session
// picker, at each Fold posture and scheme plus a docked 1280 x 860 window.
//
// The quota response is served through CDP request interception, so any app
// origin works whatever the router's CORS list says. QUOTA_FILE is a saved
// /quota JSON; without it the script reads the live router once from Node.
// CLOSED=1 closes the meters from the header first; by default they are open. OFFLINE=1
// fails every quota read, to capture the error state. SHEET=1 presses an
// account (SHEET_AT, 0-based, default 2) and captures the detail sheet over the
// whole window instead, after its landing mark has settled.
//   APP_URL=http://127.0.0.1:8520/ OUT=/tmp/meters CLOSED=1 node scripts/meters-shots.mjs
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));

const base = process.env.APP_URL ?? "http://127.0.0.1:8520/";
const out = process.env.OUT ?? "verification/local/meters-shots";
const closed = process.env.CLOSED === "1";
const offline = process.env.OFFLINE === "1";
const sheetAt = process.env.SHEET === "1" ? Number(process.env.SHEET_AT ?? "2") : undefined;
const scale = Number(process.env.SCALE ?? "2");
const schemes = (process.env.SCHEMES ?? "dark,light").split(",");
const only = process.env.POSTURES?.split(",");
const quotaUrl = process.env.QUOTA_URL ?? "https://cliproxyapi.hummingbird-lake.ts.net/quota";
const body = offline ? undefined : process.env.QUOTA_FILE ? await readFile(process.env.QUOTA_FILE, "utf8")
  : await (await fetch(quotaUrl, { headers: { origin: "http://127.0.0.1:8504" } })).text();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
if (!chromeBin) throw new Error("Chromium is required");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "meters-shots-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
const postures = [...FOLD8_POSTURES, { name: "docked", width: 1280, height: 860 }].filter((posture) => !only || only.includes(posture.name));
const report = [];
try {
  await waitForDebugger(port);
  for (const scheme of schemes) {
    for (const posture of postures) {
      const cdp = await openPosturePage({ debugPort: port, posture, colorScheme: scheme });
      const errors = [];
      cdp.listeners.set("Runtime.exceptionThrown", [(event) => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)]);
      cdp.listeners.set("Runtime.consoleAPICalled", [(event) => { if (event.type === "error" || event.type === "warning") errors.push(event.args.map((arg) => arg.description ?? arg.value).join(" ").slice(0, 300)); }]);
      await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `${new URL(quotaUrl).origin}/*` }] });
      cdp.listeners.set("Fetch.requestPaused", [(event) => {
        if (body === undefined) { void cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "ConnectionRefused" }); return; }
        void cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200, body: Buffer.from(body).toString("base64"),
          responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: "*" }] });
      }]);
      const load = async () => {
        const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
        await cdp.send("Page.navigate", { url: base });
        await loaded;
      };
      await load();
      await evaluate(cdp, closed ? `(localStorage.setItem("forgerie.accountMeters.closed", "true"), true)` : `(localStorage.removeItem("forgerie.accountMeters.closed"), true)`);
      await load();
      const ready = async (predicate, what) => {
        for (let i = 0; i < 240; i += 1) {
          if (await evaluate(cdp, predicate)) return;
          // The session list can stall on a cold server; one reload gets past it.
          if (i === 120) await load();
          await sleep(250);
        }
        const dom = await evaluate(cdp, `(document.querySelector(".picker-room")?.outerHTML ?? document.body.innerHTML).replace(/<svg.*?<\\/svg>/g, "").slice(0, 1500)`);
        throw new Error(`${posture.name}: ${what} never happened. Errors: ${JSON.stringify(errors)}. Page: ${dom}`);
      };
      await ready(`document.querySelectorAll(".picker-row").length > 0`, "picker rows");
      await evaluate(cdp, `(document.querySelector(".app-opener")?.getAttribute("aria-expanded") === "false" && document.querySelector(".app-opener").click(), true)`);
      await ready(`!!document.querySelector(${closed ? '".shelf-header[aria-expanded=false]"' : offline ? '".shelf-message[role=alert]"' : '".lane-grid"'})`, "meters");
      await sleep(600);
      await evaluate(cdp, `Promise.all([document.fonts.load('500 13px "Public Sans Variable"'), document.fonts.load('11px "JetBrains Mono Variable"')]).then(() => document.fonts.ready).then(() => true)`);
      await sleep(200);
      const box = await evaluate(cdp, `(() => { const r = document.querySelector(".picker").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
      const meters = await evaluate(cdp, `(() => {
        const section = document.querySelector('section[aria-label="Account meters"]'), body = document.querySelector(".shelf-body") ?? section, list = document.querySelector(".picker-list");
        return { height: Math.round(section.getBoundingClientRect().height), scrolls: body.scrollHeight > body.clientHeight + 1,
          list: Math.round(list?.getBoundingClientRect().height ?? 0), names: document.querySelectorAll(".lane-grid-caption").length,
          lane: Math.round(document.querySelector(".lane-grid-mark")?.getBoundingClientRect().width ?? 0),
          overflow: [...document.querySelectorAll(".lane-grid-name, .lane-grid-caption, .lane-grid-label")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent) };
      })()`);
      let sheet;
      if (sheetAt !== undefined) {
        await evaluate(cdp, `(document.querySelectorAll(".shelf .lane-grid-block")[${String(sheetAt)}].click(), true)`);
        await ready(`!!document.querySelector(".sheet-dialog[open] .lane-grid")`, "quota sheet");
        await sleep(2000);
        sheet = await evaluate(cdp, `(() => {
          const body = document.querySelector(".sheet-dialog-body"), chosen = document.querySelector(".sheet-dialog [data-chosen]");
          const b = body.getBoundingClientRect(), c = chosen?.getBoundingClientRect();
          return { chosen: chosen?.getAttribute("aria-label"), inView: !!c && c.top >= b.top && c.bottom <= b.bottom,
            scrolls: body.scrollHeight > body.clientHeight + 1, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            overflow: [...document.querySelectorAll(".sheet-dialog .lane-grid-caption, .sheet-dialog .lane-grid-label")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent) };
        })()`);
      }
      const shot = await cdp.send("Page.captureScreenshot", sheetAt === undefined ? { format: "png", clip: { ...box, scale: scale / 2.625 } } : { format: "png" });
      const file = join(out, `${sheetAt === undefined ? "" : "sheet-"}${posture.name}-${scheme}.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      report.push({ posture: posture.name, scheme, picker: `${Math.round(box.width)}x${Math.round(box.height)}`, meters, sheet, errors });
      await cdp.close?.();
    }
  }
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true });
}
await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify(report, null, 1));
