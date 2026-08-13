#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
/**
 * PROTOTYPE check — drives the pen prototype in headless Chromium over CDP.
 *
 * Chromium can synthesize a real pen pointer (`pointerType: "pen"`), so this
 * exercises the same code path the S Pen will hit: hover arming, pressure,
 * lasso classification, and the resulting context chips.
 *
 * Usage: ./check-pen.mjs [baseUrl] [outDir]
 */

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire("/home/simonwjackson/code/sandbox/forgerie/package.json");
const WebSocket = require("ws");

const BASE = process.argv[2] ?? "http://127.0.0.1:8600/pen-context/";
const OUT = process.argv[3] ?? "/tmp/pen-proto";
const PORT = 9422;
const VIEWPORTS = [
  ["tab-landscape", 1280, 800],
  ["unfolded-portrait", 704, 783],
];

await mkdir(OUT, { recursive: true });

const chromium = spawn("chromium", [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${String(PORT)}`,
  "--window-size=1280,800",
  "about:blank",
], { stdio: "ignore" });

process.on("exit", () => chromium.kill());
await waitForPort();

const target = await fetchJson(`http://127.0.0.1:${String(PORT)}/json/new?about:blank`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.on("open", resolve));

const consoleErrors = [];
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.text ?? "exception");
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "?").join(" "));
  }
});

let nextId = 0;
await send("Runtime.enable");
await send("Page.enable");

const findings = [];

for (const [name, width, height] of VIEWPORTS) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
  for (const variant of ["context", "margin", "sketch", "probe"]) {
    await send("Page.navigate", { url: `${BASE}?v=${variant}` });
    await delay(900);
    if (variant === "context") await drawLasso();
    if (variant === "margin") await drawMarginMark();
    if (variant === "sketch") await drawSquiggle();
    if (variant === "probe") await drawSquiggle(200, 220);
    await delay(400);
    findings.push(`${name} · ${variant}: ${await describeState(variant)}`);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${OUT}/${name}-${variant}.png`, Buffer.from(shot.data, "base64"));
  }
}

// Regression: the pen must draw on first contact, with no hover beforehand.
// That is the "works only after the first release" bug.
await send("Page.navigate", { url: `${BASE}?v=context` });
await delay(900);
await coldStroke();
findings.push(`cold first stroke (no hover): ${await describeState("context")}`);

for (const line of findings) console.log(line);
console.log("console errors:", consoleErrors.length === 0 ? "none" : consoleErrors.join(" | "));
console.log("screenshots in", OUT);

socket.close();
chromium.kill();
process.exit(consoleErrors.length === 0 ? 0 : 1);

/** Circles the code block in the transcript, the way a pen would. */
async function drawLasso() {
  const box = await evaluate(`(() => {
    const first = document.querySelector("pre.code .line");
    const last = document.querySelectorAll("pre.code .line")[2];
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    return JSON.stringify({ left: a.left, top: a.top, right: a.right, bottom: b.bottom });
  })()`);
  const rect = JSON.parse(box.value);
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const rx = (rect.right - rect.left) / 2 + 8;
  const ry = (rect.bottom - rect.top) / 2 + 10;

  const path = [];
  for (let step = 0; step <= 36; step += 1) {
    const angle = (step / 36) * Math.PI * 2;
    path.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  await penStroke(path);
}

async function drawMarginMark() {
  const box = await evaluate(`(() => {
    const row = document.querySelectorAll(".row")[4];
    const rect = row.querySelector(".gutter").getBoundingClientRect();
    return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  })()`);
  const point = JSON.parse(box.value);
  await penStroke([
    [point.x - 18, point.y - 6],
    [point.x - 6, point.y + 6],
    [point.x + 14, point.y - 10],
  ]);
}

async function drawSquiggle(startX = 300, startY = 300) {
  const path = [];
  for (let step = 0; step < 24; step += 1) {
    path.push([startX + step * 8, startY + Math.sin(step / 2) * 22]);
  }
  await penStroke(path);
}

/** Hovers first (to arm the layer), then draws with pressure. */
async function penStroke(path) {
  const [firstX, firstY] = path[0];
  await pen("mouseMoved", firstX, firstY, 0, 0);
  await delay(120);
  await pen("mousePressed", firstX, firstY, 1, 0.6);
  for (const [x, y] of path.slice(1)) {
    await pen("mouseMoved", x, y, 1, 0.6);
  }
  await pen("mouseReleased", path[path.length - 1][0], path[path.length - 1][1], 0, 0, "left");
  await delay(150);
}

/** Touches down with no hover first — the case that used to lose the stroke. */
async function coldStroke() {
  const box = await evaluate(`(() => {
    const rect = document.querySelectorAll("pre.code .line")[1].getBoundingClientRect();
    return JSON.stringify({ x: rect.left + 20, y: rect.top + rect.height / 2 });
  })()`);
  const start = JSON.parse(box.value);
  await pen("mousePressed", start.x, start.y, 1, 0.5);
  for (let step = 1; step <= 20; step += 1) await pen("mouseMoved", start.x + step * 12, start.y, 1, 0.5);
  await pen("mouseReleased", start.x + 240, start.y, 0, 0, "left");
  await delay(250);
}

/** Reports what the marks produced, so a silent regression cannot pass. */
async function describeState(variant) {
  const expression = variant === "margin"
    ? `JSON.stringify({ notes: document.querySelectorAll(".note").length, strokes: window.__ink.strokes.length })`
    : `JSON.stringify({ chips: [...document.querySelectorAll(".chip")].map((chip) => chip.textContent), strokes: window.__ink?.strokes.length ?? "n/a" })`;
  const result = await evaluate(expression);
  return String(result.value);
}

function pen(type, x, y, buttons, force, button) {
  return send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: button ?? (buttons === 0 ? "none" : "left"),
    buttons,
    clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
    pointerType: "pen",
    force,
    tiltX: 12,
    tiltY: -7,
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true });
  return result.result;
}

function send(method, params = {}) {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id !== id) return;
      socket.off("message", onMessage);
      if (message.error !== undefined) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { method: "PUT" }).catch(() => fetch(url));
  return response.json();
}

async function waitForPort() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${String(PORT)}/json/version`);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("chromium did not start");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
