#!/usr/bin/env node
/**
 * Why does a press do nothing?
 *
 * Presses with **real touch**, through the browser's own input pipeline, not a
 * synthesised PointerEvent aimed at an element. Only the real path exercises
 * scroll hand-off, `pointercancel`, and the platform's own long-press
 * behaviour — which is exactly where a gesture that works in a headless
 * screenshot still fails in a hand.
 *
 * Reports three things a screenshot cannot: console errors, whether the
 * surface opened, and whether the platform took the press for text selection.
 *
 * Usage: node diagnose.mjs [url]
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const BASE = process.argv[2] ?? "http://127.0.0.1:8600/thumb-fan/";
const PORT = 9338;

const CASES = [
  { variant: "radial", width: 704, height: 783, where: "text" },
  { variant: "radial", width: 704, height: 783, where: "gutter" },
  { variant: "radial", width: 475, height: 638, where: "text" },
  { variant: "radial", width: 711, height: 374, where: "text" },
  { variant: "discs", width: 711, height: 374, where: "text" },
];

let nextId = 0;

const chrome = spawn("chromium", [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  `--remote-debugging-port=${String(PORT)}`, "about:blank",
], { stdio: "ignore" });
process.on("exit", () => { chrome.kill(); });

const targetUrl = await waitForTarget();
console.log("\nvariant  viewport   press    errors  opened  selection  readout");

for (const testCase of CASES) {
  const socket = await connect(targetUrl);
  const errors = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails?.exception?.description
        ?? message.params.exceptionDetails?.text ?? "unknown");
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error"
      && !message.params.entry.text.includes("favicon")) {
      errors.push(message.params.entry.text);
    }
  });

  await send(socket, "Runtime.enable", {});
  await send(socket, "Log.enable", {});
  await send(socket, "Emulation.setDeviceMetricsOverride", {
    width: testCase.width, height: testCase.height, deviceScaleFactor: 1, mobile: true,
    screenWidth: testCase.width, screenHeight: testCase.height,
  });
  await send(socket, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send(socket, "Page.enable", {});

  const url = new URL(BASE);
  url.searchParams.set("v", testCase.variant);
  await send(socket, "Page.navigate", { url: url.toString() });
  await delay(1400);

  // Aim at a real paragraph, or at the dead gutter beside one.
  const spot = await evaluate(socket, `(() => {
    const selector = ${JSON.stringify(testCase.where === "gutter" ? ".turn .gutter" : ".turn .body p")};
    const nodes = [...document.querySelectorAll(selector)];
    const node = nodes[Math.min(2, nodes.length - 1)];
    if (node === undefined) return "";
    const box = node.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) });
  })()`);
  if (spot === "") { console.log(`${testCase.variant}: no press target found`); socket.close(); continue; }
  const { x, y } = JSON.parse(spot);

  await send(socket, "Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await delay(750);
  await send(socket, "Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 60, y: y - 40, id: 1 }] });
  await delay(200);

  const result = await evaluate(socket, `(() => {
    if (document.querySelector("#stage") === null) return "NO STAGE|?|module never ran";
    const opened = document.querySelectorAll("#surface > *").length > 0;
    const selected = (window.getSelection()?.toString() ?? "").trim().length > 0;
    const readout = document.querySelector("#readout div")?.textContent ?? "";
    return (opened ? "yes" : "NO") + "|" + (selected ? "TOOK IT" : "clear") + "|" + readout.slice(0, 40);
  })()`);

  await send(socket, "Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  const [opened, selection, readout] = String(result).split("|");
  const size = `${testCase.width}x${testCase.height}`.padEnd(9);
  console.log(`${testCase.variant.padEnd(8)} ${size} ${testCase.where.padEnd(7)} ${String(errors.length).padStart(6)}  ${opened.padEnd(6)}  ${selection.padEnd(9)}  ${readout}`);
  for (const error of errors.slice(0, 2)) console.log(`         ! ${error.split("\n")[0].slice(0, 88)}`);
  socket.close();
}

console.log("");
chrome.kill();

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
    } catch { /* not up yet */ }
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
