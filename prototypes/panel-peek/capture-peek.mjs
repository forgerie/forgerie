/**
 * Drag a sheet in with real pointer events and photograph it part-way.
 *
 * A peek is a moving thing, so the useful picture is mid-drag: it shows the
 * sheet following the finger, the session still readable behind it, and the
 * scrim at exactly the share of the sheet that shows.
 *
 * Usage: FORGERIE_SESSION=<id> node capture-peek.mjs [url] [outDir]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const URL_ARG = process.argv[2] ?? "http://127.0.0.1:8504/";
const OUT = process.argv[3] ?? "/tmp/fg-peek";
const SESSION = process.env["FORGERIE_SESSION"] ?? "";
const PORT = 9334;

const SHOTS = [
  { name: "folded-portrait-half", width: 499, height: 789, fraction: 0.5, release: false },
  { name: "folded-portrait-open", width: 499, height: 789, fraction: 0.95, release: true },
  { name: "unfolded-portrait-half", width: 739, height: 979, fraction: 0.5, release: false },
  { name: "folded-portrait-workspace", width: 499, height: 789, fraction: 0.95, release: true, direction: -1 },
];

let nextId = 0;

mkdirSync(OUT, { recursive: true });

const chrome = spawn("chromium", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${String(PORT)}`,
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => { chrome.kill(); });

const targetUrl = await waitForTarget();
for (const shot of SHOTS) await capture(targetUrl, shot);
chrome.kill();

async function capture(wsTargetUrl, shot) {
  const socket = await connect(wsTargetUrl);
  await send(socket, "Emulation.setDeviceMetricsOverride", {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send(socket, "Page.enable", {});
  await send(socket, "Page.navigate", { url: SESSION === "" ? URL_ARG : `${URL_ARG}?session=${SESSION}` });
  await delay(6000);

  const state = await evaluate(socket, dragScript(shot.fraction, shot.release, shot.direction ?? 1));
  const image = await send(socket, "Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${shot.name}.png`, Buffer.from(image.data, "base64"));
  console.log(`${shot.name}: ${state} -> ${OUT}/${shot.name}.png`);
  socket.close();
}

function dragScript(fraction, release, direction) {
  return `(async () => {
    const app = document.querySelector("pi-web-app");
    const shell = app.shadowRoot.querySelector(".shell");
    if (shell === null) return "no-shell";
    const sheetWidth = Math.min(360, Math.round(app.clientWidth * 0.85));
    const distance = Math.round(sheetWidth * ${String(fraction)});
    const y = Math.round(window.innerHeight / 2);
    const fire = (type, x) => {
      const event = new PointerEvent(type, { bubbles: true, composed: true, pointerId: 1, pointerType: "touch", clientX: x, clientY: y });
      shell.dispatchEvent(event);
    };
    const direction = ${String(direction)};
    const start = direction > 0 ? 20 : window.innerWidth - 20;
    fire("pointerdown", start);
    await new Promise((r) => setTimeout(r, 16));
    for (let travelled = 12; travelled <= distance; travelled += 24) {
      fire("pointermove", start + direction * travelled);
      await new Promise((r) => setTimeout(r, 16));
    }
    fire("pointermove", start + direction * distance);
    ${release ? 'fire("pointerup", start + direction * distance);' : ""}
    await new Promise((r) => setTimeout(r, 400));
    const sheet = app.shadowRoot.querySelector(".peek-sheet");
    if (sheet === null) return "no-sheet";
    return `+"`"+`side=${"$"}{sheet.dataset.side} progress=${"$"}{sheet.style.getPropertyValue("--peek-progress")}`+"`"+`;
  })()`;
}

async function evaluate(socket, expression) {
  const result = await send(socket, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return result.result?.value ?? "unknown";
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`);
      const targets = await response.json();
      const page = targets.find((entry) => entry.type === "page");
      if (page !== undefined) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is not listening yet.
    }
    await delay(200);
  }
  throw new Error("Chromium never opened its debugging port");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => { resolve(socket); });
    socket.addEventListener("error", reject);
  });
}

function send(socket, method, params) {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error !== undefined) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
