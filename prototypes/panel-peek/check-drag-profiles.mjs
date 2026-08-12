/**
 * Run several shapes of real drag and report which ones open a sheet.
 *
 * "It works sometimes" is a statement about which shape of drag the hand
 * happened to make. This turns that into a table: each row is a way a finger
 * really moves, and the result says whether the shell kept the gesture or the
 * browser took it.
 *
 * Usage: FORGERIE_SESSION=<id> node check-drag-profiles.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 9338;
const SESSION = process.env["FORGERIE_SESSION"] ?? "";
let nextId = 0;

/** Each profile is a list of [x, y] points a finger passes through. */
const PROFILES = [
  { name: "straight across", points: straight() },
  { name: "drifts down first", points: [[32, 402], [34, 408], [40, 412], ...straight().slice(2)] },
  { name: "rests before moving", points: straight(), restMs: 600 },
  { name: "slow start", points: [[31, 400], [33, 400], [36, 400], [40, 400], ...straight().slice(2)] },
  { name: "arcs downward while crossing", points: arc() },
  { name: "flick", points: [[30, 400], [150, 400], [300, 400]] },
  { name: "scrolls down (must not open)", points: [[200, 600], [204, 500], [208, 380], [210, 260]] },
];

const chrome = spawn("chromium", ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${String(PORT)}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => { chrome.kill(); });

const targetUrl = await waitForTarget();
const results = [];
for (const profile of PROFILES) results.push(await run(targetUrl, profile));

console.log("");
console.log("| drag | pointer events | sheet |");
console.log("|---|---|---|");
for (const row of results) console.log(`| ${row.name} | ${row.events} | ${row.sheet} |`);

chrome.kill();

async function run(wsUrl, profile) {
  const socket = await connect(wsUrl);
  await send(socket, "Emulation.setDeviceMetricsOverride", { width: 499, height: 789, deviceScaleFactor: 1, mobile: true });
  await send(socket, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send(socket, "Page.enable", {});
  await send(socket, "Page.navigate", { url: `http://127.0.0.1:8504/?session=${SESSION}` });
  await delay(5000);

  await ev(socket, `(() => {
    const shell = document.querySelector("pi-web-app").shadowRoot.querySelector(".shell");
    globalThis.seen = [];
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      shell.addEventListener(type, () => { globalThis.seen.push(type); }, true);
    }
    return "ok";
  })()`);

  const [first, ...rest] = profile.points;
  await send(socket, "Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: first[0], y: first[1] }] });
  if (profile.restMs !== undefined) await delay(profile.restMs);
  for (const [x, y] of rest) {
    await send(socket, "Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await delay(16);
  }
  await send(socket, "Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(400);

  const events = await ev(socket, `(() => {
    const seen = globalThis.seen ?? [];
    const moves = seen.filter((e) => e === "pointermove").length;
    const cancelled = seen.includes("pointercancel");
    return moves + " moves" + (cancelled ? " + CANCEL" : "");
  })()`);
  const sheet = await ev(socket, `String(document.querySelector("pi-web-app")?.shadowRoot?.querySelector(".panel-surface[data-mode='sheet']")?.dataset.side ?? "none")`);
  const where = await ev(socket, "String(location.pathname + location.search).slice(0, 40)");
  if (where.indexOf("session=") === -1) console.log("  !! navigated away:", where);
  socket.close();
  return { name: profile.name, events, sheet };
}

function straight() {
  const points = [];
  for (let x = 30; x <= 330; x += 25) points.push([x, 400]);
  return points;
}

function arc() {
  const points = [];
  for (let step = 0; step <= 12; step += 1) points.push([30 + step * 25, 400 + step * step * 1.2]);
  return points;
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
