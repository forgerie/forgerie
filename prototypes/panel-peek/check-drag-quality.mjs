/**
 * Two numbers the eye reports as "not smooth" and "flaky".
 *
 * Smoothness: how many times the sheet's transform actually changed compared
 * with how many moves the finger made. A sheet that follows the hand changes on
 * every move. One that lags changes on a fraction of them.
 *
 * Flakiness: the same drag, many times, over a real transcript at several
 * heights. The failure rate is the number the hand is feeling.
 *
 * Usage: FORGERIE_SESSION=<id> node check-drag-quality.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 9340;
const SESSION = process.env["FORGERIE_SESSION"] ?? "";
const TRIALS_PER_HEIGHT = 6;
const HEIGHTS = [180, 320, 460, 600, 720];
let nextId = 0;

/** Walks shadow roots, since the panels live inside several of them. */
const DEEP = `((root, sel) => {
  const search = (node) => {
    const scope = node.shadowRoot ?? node;
    const hit = scope.querySelector(sel);
    if (hit !== null) return hit;
    for (const child of scope.querySelectorAll("*")) {
      if (child.shadowRoot) { const found = search(child); if (found !== null) return found; }
    }
    return null;
  };
  return search(root);
})`;

const chrome = spawn("chromium", ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${String(PORT)}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => { chrome.kill(); });

const socket = await connect(await waitForTarget());
await send(socket, "Emulation.setDeviceMetricsOverride", { width: 499, height: 789, deviceScaleFactor: 1, mobile: true });
await send(socket, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send(socket, "Page.enable", {});
await send(socket, "Performance.enable", {});
await send(socket, "Page.navigate", { url: `http://127.0.0.1:8504/?session=${SESSION}` });
await delay(6000);
await openFirstSession();
await delay(6000);
console.log("transcript children:", await ev(socket, `String(${DEEP}(document.querySelector("pi-web-app"), ".chat")?.children.length ?? "none")`));

let failures = 0;
let trials = 0;
const smoothness = [];

for (const y of HEIGHTS) {
  let openedHere = 0;
  for (let trial = 0; trial < TRIALS_PER_HEIGHT; trial += 1) {
    const result = await dragOnce(y);
    trials += 1;
    if (result.opened) openedHere += 1;
    else failures += 1;
    if (result.frames > 0) smoothness.push(result);
    await closeAnySheet();
  }
  console.log(`y=${String(y).padStart(3)}  opened ${String(openedHere)}/${String(TRIALS_PER_HEIGHT)}`);
}

const totalMoves = smoothness.reduce((sum, s) => sum + s.moves, 0);
const totalFrames = smoothness.reduce((sum, s) => sum + s.frames, 0);
console.log("");
console.log(`opened            ${String(trials - failures)}/${String(trials)}`);
console.log(`sheet updates     ${String(totalFrames)} over ${String(totalMoves)} moves` + (totalMoves > 0 ? ` (${(totalFrames / totalMoves).toFixed(2)} per move)` : ""));
const totalRecalcs = smoothness.reduce((sum, s) => sum + s.recalcs, 0);
const totalLayouts = smoothness.reduce((sum, s) => sum + s.layouts, 0);
console.log(`style recalcs     ${(totalRecalcs / Math.max(1, totalMoves)).toFixed(1)} per move`);
console.log(`layouts           ${(totalLayouts / Math.max(1, totalMoves)).toFixed(1)} per move`);
chrome.kill();

async function dragOnce(y) {
  await ev(socket, `(() => {
    globalThis.moves = 0;
    globalThis.frames = 0;
    globalThis.lastSeen = "";
    const app = document.querySelector("pi-web-app");
    const shell = app.shadowRoot.querySelector(".shell");
    if (globalThis.watch !== undefined) shell.removeEventListener("pointermove", globalThis.watch, true);
    globalThis.watch = () => {
      globalThis.moves += 1;
      const sheet = app.shadowRoot.querySelector(".panel-surface[data-mode='sheet']");
      const now = sheet === null ? "" : sheet.style.getPropertyValue("--peek-progress");
      if (now !== "" && now !== globalThis.lastSeen) { globalThis.frames += 1; globalThis.lastSeen = now; }
    };
    shell.addEventListener("pointermove", globalThis.watch, true);
    return "watching";
  })()`);

  const before = await metrics();
  await send(socket, "Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 40, y }] });
  for (let x = 55; x <= 340; x += 15) {
    await send(socket, "Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await delay(16);
  }
  await send(socket, "Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(350);

  const stats = await ev(socket, `String(globalThis.moves) + "," + String(globalThis.frames) + "," + String(document.querySelector("pi-web-app").shadowRoot.querySelector(".panel-surface[data-mode='sheet']") !== null)`);
  const [moves, frames, opened] = stats.split(",");
  const after = await metrics();
  return {
    moves: Number(moves),
    frames: Number(frames),
    opened: opened === "true",
    recalcs: after.RecalcStyleCount - before.RecalcStyleCount,
    layouts: after.LayoutCount - before.LayoutCount,
  };
}

async function metrics() {
  const result = await send(socket, "Performance.getMetrics", {});
  const out = {};
  for (const metric of result.metrics) out[metric.name] = metric.value;
  return out;
}

async function closeAnySheet() {
  await ev(socket, `(() => {
    const scrim = document.querySelector("pi-web-app").shadowRoot.querySelector(".peek-scrim");
    if (scrim !== null) scrim.click();
    return "closed";
  })()`);
  await delay(300);
}

async function openFirstSession() {
  await ev(socket, `(() => {
    const row = ${DEEP}(document.querySelector("pi-web-app"), ".row");
    if (row === null) return "no row";
    row.click();
    return "clicked";
  })()`);
}

async function ev(s, expression) {
  const r = await send(s, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails !== undefined) return "threw";
  return String(r.result?.value);
}
async function waitForTarget() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`);
      const page = (await res.json()).find((t) => t.type === "page");
      if (page !== undefined) return page.webSocketDebuggerUrl;
    } catch { /* not up */ }
    await delay(200);
  }
  throw new Error("no target");
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(url);
    s.addEventListener("open", () => { resolve(s); });
    s.addEventListener("error", reject);
  });
}
function send(s, method, params) {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== id) return;
      s.removeEventListener("message", onMessage);
      if (m.error !== undefined) reject(new Error(m.error.message));
      else resolve(m.result);
    };
    s.addEventListener("message", onMessage);
    s.send(JSON.stringify({ id, method, params }));
  });
}
