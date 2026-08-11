/**
 * Prove that up-and-down still works where the side gesture also lives.
 *
 * The shell takes horizontal drags away from the browser. A gesture that starts
 * with a sideways wobble -- which most vertical drags do -- must not be taken
 * with it, or lists stop scrolling under the finger at random.
 *
 * Measures the scroll position of the real scroller under the finger, before
 * and after a real touch drag, in three places: inside an open sheet, on the
 * transcript, and on a drag that starts sideways before going down.
 *
 * Usage: FORGERIE_SESSION=<id> node check-vertical-scroll.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 9346;
const SESSION = process.env["FORGERIE_SESSION"] ?? "";
let nextId = 0;

/** Walks shadow roots, since the panels live inside several of them. */
const DEEP_SRC = `const deep = (root, sel) => {
  const scope = root.shadowRoot ?? root;
  const hit = scope.querySelector(sel);
  if (hit !== null) return hit;
  for (const child of scope.querySelectorAll("*")) {
    if (child.shadowRoot) { const found = deep(child, sel); if (found !== null) return found; }
  }
  return null;
};`;

const chrome = spawn("chromium", ["--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${String(PORT)}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => { chrome.kill(); });
const s = await connect(await waitForTarget());

await send(s, "Emulation.setDeviceMetricsOverride", { width: 739, height: 979, deviceScaleFactor: 1, mobile: true });
await send(s, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send(s, "Page.enable", {});
await send(s, "Page.navigate", { url: `http://127.0.0.1:8504/?session=${SESSION}` });
await delay(6000);
await ev(`(() => { ${DEEP_SRC} const row = deep(document.querySelector("pi-web-app"), ".row"); if (row) row.click(); return "ok"; })()`);
await delay(5000);

console.log("--- inside an open sheet ---");
await openSheet();
// A short list has nothing to scroll. Open the archive so the panel overflows.
console.log("archive:", await ev(`(() => { ${DEEP_SRC}
  const shelf = deep(document.querySelector("pi-web-app"), "[data-archive-shelf]");
  if (shelf === null) return "no shelf";
  shelf.click();
  return "opened";
})()`));
await delay(1500);
console.log("scroll down :", await verticalDrag(150, 600, 0, -260));
console.log("sheet after :", await sheetState());
console.log("scroll up   :", await verticalDrag(150, 340, 0, 240));
console.log("sheet after :", await sheetState());
console.log("wobble then down:", await verticalDrag(150, 600, 7, -260));
console.log("sheet after :", await sheetState());

console.log("");
console.log("--- on the transcript, no sheet ---");
await closeSheet();
console.log("scroll up   :", await verticalDrag(370, 300, 0, 300));
console.log("sheet after :", await sheetState());
console.log("wobble then up:", await verticalDrag(370, 300, 7, 300));
console.log("sheet after :", await sheetState());

chrome.kill();

/**
 * Drags from a point and reports how far the scroller under it actually moved.
 * `wobbleX` is the sideways slip a real thumb makes before it commits.
 */
async function verticalDrag(x, y, wobbleX, dy) {
  const before = await scrollTopAt(x, y);
  await send(s, "Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  if (wobbleX !== 0) {
    await send(s, "Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + wobbleX, y: y - 2 }] });
    await delay(16);
  }
  const steps = 16;
  for (let step = 1; step <= steps; step += 1) {
    await send(s, "Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + wobbleX, y: y + Math.round((dy * step) / steps) }] });
    await delay(16);
  }
  await send(s, "Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(500);
  const after = await scrollTopAt(x, y);
  const value = (text) => Number(String(text).split("=")[1] ?? Number.NaN);
  const moved = Math.abs(value(after) - value(before));
  return `${before} -> ${after}  (${moved > 4 ? `scrolled ${String(moved)}px` : "DID NOT SCROLL"})`;
}

async function scrollTopAt(x, y) {
  return ev(`(() => {
    // Pierce down through shadow roots to the element really under the point,
    // then walk back up to the first thing that scrolls vertically.
    let node = document.elementFromPoint(${String(x)}, ${String(y)});
    while (node?.shadowRoot) {
      const inner = node.shadowRoot.elementFromPoint(${String(x)}, ${String(y)});
      if (inner === null || inner === node) break;
      node = inner;
    }
    while (node) {
      if (node.scrollHeight - node.clientHeight > 4) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          return node.tagName.toLowerCase() + "." + String(node.className || "-").split(" ")[0] + "=" + String(Math.round(node.scrollTop));
        }
      }
      node = node.parentElement ?? node.getRootNode()?.host ?? null;
    }
    return "no-scroller";
  })()`);
}

async function openSheet() {
  await closeSheet();
  await send(s, "Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 20, y: 480 }] });
  for (let t = 15; t <= 340; t += 15) {
    await send(s, "Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 20 + t, y: 480 }] });
    await delay(12);
  }
  await send(s, "Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(450);
}

async function closeSheet() {
  await ev(`(() => { const sc = document.querySelector("pi-web-app").shadowRoot.querySelector(".peek-scrim"); if (sc) sc.click(); return "x"; })()`);
  await delay(350);
}

async function sheetState() {
  return ev(`(() => { const el = document.querySelector("pi-web-app").shadowRoot.querySelector(".peek-sheet");
    return el === null ? "closed" : "open@" + (el.style.getPropertyValue("--peek-progress") || "?"); })()`);
}

async function ev(expression) {
  const r = await send(s, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails !== undefined) return "threw";
  return String(r.result?.value);
}
async function waitForTarget() {
  for (let i = 0; i < 50; i += 1) {
    try { const res = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`);
      const p = (await res.json()).find((t) => t.type === "page"); if (p) return p.webSocketDebuggerUrl; } catch { /* */ }
    await delay(200);
  }
  throw new Error("no target");
}
function connect(url) {
  return new Promise((res, rej) => { const k = new WebSocket(url);
    k.addEventListener("open", () => { res(k); }); k.addEventListener("error", rej); });
}
function send(k, method, params) {
  const id = (nextId += 1);
  return new Promise((res, rej) => {
    const on = (e) => { const m = JSON.parse(e.data); if (m.id !== id) return;
      k.removeEventListener("message", on); if (m.error) rej(new Error(m.error.message)); else res(m.result); };
    k.addEventListener("message", on); k.send(JSON.stringify({ id, method, params }));
  });
}
