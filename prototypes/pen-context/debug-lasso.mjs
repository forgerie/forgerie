#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
/** PROTOTYPE debug — why did the lasso not select any line? */

import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire("/home/simonwjackson/code/sandbox/forgerie/package.json");
const WebSocket = require("ws");
const PORT = 9424;

const chromium = spawn("chromium", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${String(PORT)}`, "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chromium.kill());
await waitForPort();

const target = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.on("open", resolve));
let nextId = 0;

socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === "Runtime.exceptionThrown") console.log("EXCEPTION", JSON.stringify(message.params.exceptionDetails).slice(0, 400));
});

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
await send("Page.enable");
await send("Page.navigate", { url: "http://127.0.0.1:8600/pen-context/?v=context" });
await delay(900);

const box = JSON.parse((await evaluate(`(() => {
  const lines = document.querySelectorAll("pre.code .line");
  const a = lines[0].getBoundingClientRect();
  const b = lines[2].getBoundingClientRect();
  return JSON.stringify({ left: a.left, top: a.top, right: a.right, bottom: b.bottom });
})()`)).value);

const cx = (box.left + box.right) / 2;
const cy = (box.top + box.bottom) / 2;
const rx = (box.right - box.left) / 2 + 8;
const ry = (box.bottom - box.top) / 2 + 10;
const path = [];
for (let step = 0; step <= 36; step += 1) {
  const angle = (step / 36) * Math.PI * 2;
  path.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
}

await pen("mouseMoved", path[0][0], path[0][1], 0, 0);
await delay(120);
await pen("mousePressed", path[0][0], path[0][1], 1, 0.6);
for (const [x, y] of path.slice(1)) await pen("mouseMoved", x, y, 1, 0.6);
await pen("mouseReleased", path[path.length - 1][0], path[path.length - 1][1], 0, 0, "left");
await delay(300);

const report = await evaluate(`(() => {
  const ink = window.__ink;
  const stroke = ink.strokes[ink.strokes.length - 1];
  const lines = [...document.querySelectorAll("[data-ref]")].slice(0, 12).map((element) => {
    const rect = ink.rectFor(element);
    return { ref: element.dataset.ref, line: element.dataset.line, rect };
  });
  return JSON.stringify({
    strokes: ink.strokes.length,
    kind: stroke === undefined ? "none" : stroke.kind,
    box: stroke === undefined ? undefined : stroke.box,
    chips: document.querySelectorAll(".chip").length,
    armed: ink.armed,
    lines,
  }, undefined, 1);
})()`);
console.log(report.value);

socket.close();
chromium.kill();

function pen(type, x, y, buttons, force, button) {
  return send("Input.dispatchMouseEvent", { type, x, y, button: button ?? (buttons === 0 ? "none" : "left"), buttons, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0, pointerType: "pen", force, tiltX: 10, tiltY: -5 });
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
