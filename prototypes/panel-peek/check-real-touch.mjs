/**
 * Drag a sheet in with a REAL touch, through the browser's own input pipeline.
 *
 * This exists because the first version of the gesture passed every unit test
 * and could not work. Those tests dispatched `new PointerEvent()` from JS,
 * which skips touch-action and skips the compositor deciding to scroll instead.
 * `Input.dispatchTouchEvent` does not skip them.
 *
 * A pass prints every pointermove and a sheet side. A regression prints
 * `pointercancel` and `none`: the browser took the gesture.
 *
 * Usage: FORGERIE_SESSION=<id> node check-real-touch.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 9337;
const SESSION = process.env["FORGERIE_SESSION"] ?? "";
let nextId = 0;

const chrome = spawn("chromium", ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${String(PORT)}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => { chrome.kill(); });

const socket = await connect(await waitForTarget());
await send(socket, "Emulation.setDeviceMetricsOverride", { width: 499, height: 789, deviceScaleFactor: 1, mobile: true });
await send(socket, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send(socket, "Page.enable", {});
await send(socket, "Page.navigate", { url: `http://127.0.0.1:8504/?session=${SESSION}` });
await delay(6000);

console.log("setup:", await ev(socket, `(() => {
  const shell = document.querySelector("pi-web-app").shadowRoot.querySelector(".shell");
  if (shell === null) return "no shell";
  globalThis.seen = [];
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    shell.addEventListener(type, (e) => { globalThis.seen.push(type + "/" + e.pointerType); }, true);
  }
  return "ok touchAction=" + getComputedStyle(shell).touchAction;
})()`));

const y = 400;
await send(socket, "Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 30, y }] });
for (let x = 50; x <= 300; x += 25) {
  await send(socket, "Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  await delay(16);
}
console.log("seen:", await ev(socket, "String((globalThis.seen ?? []).join(' '))"));
console.log("sheet:", await ev(socket, `String(document.querySelector("pi-web-app").shadowRoot.querySelector(".peek-sheet")?.dataset.side ?? "none")`));
await send(socket, "Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
chrome.kill();

async function ev(s, expression) {
  const r = await send(s, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails !== undefined) return `THREW ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`;
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
