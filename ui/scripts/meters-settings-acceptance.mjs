#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Acceptance: Settings > Plugins > Account meters drives the meters under the
// session list without a reload. Opens a docked window with both visible,
// turns the Seven-day window off and on again, and the plugin off and on
// again, checking the meters after each change. The quota is served from
// QUOTA_FILE through CDP interception. It writes the plugin's settings in
// the Forgerie config of the server at APP_URL, and restores them.
//   APP_URL=http://127.0.0.1:8520/ QUOTA_FILE=/tmp/quota.json node scripts/meters-settings-acceptance.mjs
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("..");
const { getFreePort, launchChrome, sleep, waitForDebugger, evaluate } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));

const base = process.env.APP_URL ?? "http://127.0.0.1:8520/";
const quotaUrl = process.env.QUOTA_URL ?? "https://cliproxyapi.hummingbird-lake.ts.net/quota";
if (!process.env.QUOTA_FILE) throw new Error("Set QUOTA_FILE to a saved /quota response.");
const body = await readFile(process.env.QUOTA_FILE, "utf8");
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
const profile = await mkdtemp(join(tmpdir(), "meters-settings-"));
const port = await getFreePort();
const chrome = launchChrome(chromeBin, port, profile);
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`); };
try {
  await waitForDebugger(port);
  const cdp = await openPosturePage({ debugPort: port, posture: { name: "docked", width: 1280, height: 860 }, colorScheme: "dark" });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `${new URL(quotaUrl).origin}/*` }] });
  cdp.listeners.set("Fetch.requestPaused", [(event) => void cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
    body: Buffer.from(body).toString("base64"), responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: "*" }] })]);
  const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
  await cdp.send("Page.navigate", { url: new URL("?settings=plugins&plugin=app%3Acliproxyapi-quota", base).href });
  await loaded;
  const until = async (predicate, what) => {
    for (let i = 0; i < 240; i += 1) { if (await evaluate(cdp, predicate)) return true; await sleep(250); }
    throw new Error(`${what} never happened`);
  };
  const lanes = `[...document.querySelectorAll(".lane-grid-mark")].map((node) => node.getAttribute("aria-label"))`;
  const sevenDay = `${lanes}.filter((text) => text.startsWith("Seven-day")).length`;
  const click = (label) => evaluate(cdp, `(document.querySelector('[aria-label="${label}"]').click(), true)`);
  await until(`!!document.querySelector(".lane-grid") && !!document.querySelector('[aria-label="Seven-day window"]')`, "meters and settings");
  const before = await evaluate(cdp, sevenDay);
  const startedOn = await evaluate(cdp, `document.querySelector('[aria-label="Seven-day window"]').getAttribute("aria-checked") === "true"`);
  check("the Seven-day window starts on, with its lanes drawn", startedOn && before > 0, { lanes: before });
  await click("Seven-day window");
  await until(`${sevenDay} === 0`, "Seven-day lanes leaving");
  check("turning the Seven-day window off removes its lanes at once", true);
  await click("Seven-day window");
  await until(`${sevenDay} === ${String(before)}`, "Seven-day lanes returning");
  check("turning it on again draws them again", true);
  await click("Load Account meters");
  await until(`!document.querySelector('section[aria-label="Account meters"]')`, "meters leaving");
  check("turning the plugin off removes the meters", true);
  await click("Load Account meters");
  await until(`!!document.querySelector(".lane-grid")`, "meters returning");
  check("turning it on again draws them again", true);
  const notice = await evaluate(cdp, `!!document.querySelector(".notice[data-tone=pending]")`);
  check("no restart is asked for", !notice);
  await cdp.close?.();
} catch (error) {
  check("acceptance run", false, error instanceof Error ? error.message : String(error));
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true });
}
process.exitCode = checks.every((entry) => entry.ok) ? 0 : 1;
