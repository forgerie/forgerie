#!/usr/bin/env node
/**
 * Press, hold, and sweep with real pointer events, then photograph each
 * variant open under the finger.
 *
 * `check-fan.mjs` proves the arithmetic and `check-contrast.mjs` proves the
 * colours. This proves the pixels: that a correct layout produces a surface a
 * person would recognise, in each posture, for each design variation.
 *
 * It also counts DOM rebuilds during the sweep. Rebuilding a surface's
 * elements on every hover change replays their entry animation and the whole
 * thing blinks; the only number that may be non-zero is caption text swaps.
 *
 * Usage: node capture-fan.mjs [url] [outDir]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const URL_ARG = process.argv[2] ?? "http://127.0.0.1:8600/thumb-fan/";
const OUT = process.argv[3] ?? "/tmp/fg-thumb-fan";
const PORT = 9336;

const POSTURES = [
  { name: "unfolded-portrait", width: 704, height: 783, press: { x: 0.86, y: 0.82 } },
  { name: "folded-portrait", width: 475, height: 638, press: { x: 0.82, y: 0.8 } },
  { name: "folded-landscape", width: 711, height: 374, press: { x: 0.95, y: 0.92 } },
];

const ALL_VARIANTS = ["discs", "labels", "radial", "column", "knob"];

/** `FG_VARIANTS=radial` narrows a run while iterating on one design. */
const VARIANTS = (process.env["FG_VARIANTS"] ?? "").trim() === ""
  ? ALL_VARIANTS
  : process.env["FG_VARIANTS"].split(",").map((name) => name.trim()).filter((name) => ALL_VARIANTS.includes(name));

const SHOTS = VARIANTS.flatMap((variant) => POSTURES.map((posture) => ({
  ...posture,
  variant,
  name: `${variant}-${posture.name}`,
})));

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

  const url = new URL(URL_ARG);
  url.searchParams.set("v", shot.variant);
  await send(socket, "Page.navigate", { url: url.toString() });
  await delay(1200);

  const state = await evaluate(socket, pressScript(shot));
  const image = await send(socket, "Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${shot.name}.png`, Buffer.from(image.data, "base64"));
  console.log(`${shot.name.padEnd(30)} ${state}`);
  socket.close();
}

/**
 * Hold still past the arm delay, then sweep.
 *
 * The sweep runs an arc *and* a vertical pass, because the variants do not
 * share a selection space: two read a bearing, one reads a row band, one reads
 * vertical travel. Running both means every variant's crossings are exercised
 * by the same script.
 */
function pressScript(shot) {
  return `(async () => {
    const stage = document.querySelector("#stage");
    const x = Math.round(window.innerWidth * ${String(shot.press.x)});
    const y = Math.round(window.innerHeight * ${String(shot.press.y)});
    const fire = (type, px, py) => {
      stage.dispatchEvent(new PointerEvent(type, {
        bubbles: true, composed: true, pointerId: 1, pointerType: "touch", clientX: px, clientY: py,
      }));
    };
    const rest = (ms) => new Promise((r) => setTimeout(r, ms));

    fire("pointerdown", x, y);
    await rest(700);

    const nodes = document.querySelectorAll("#surface .disc, #surface .row, #surface .wedge, #surface .knob-tick");
    if (nodes.length === 0) return "surface did not open";

    let rebuilds = 0;
    let textSwaps = 0;
    const tally = (list) => {
      let elements = 0;
      for (const node of list) if (node.nodeType === 1) elements += 1;
      return { elements, text: list.length - elements };
    };
    new MutationObserver((records) => {
      for (const record of records) {
        const added = tally(record.addedNodes);
        const removed = tally(record.removedNodes);
        rebuilds += added.elements + removed.elements;
        textSwaps += added.text + removed.text;
      }
    }).observe(document.querySelector("#surface"), { childList: true, subtree: true });

    let moves = 0;
    // Arc pass: down-right, through left, to up-left.
    for (let step = 0; step <= 90; step += 1) {
      const bearing = (20 + (200 - 20) * (step / 90)) * Math.PI / 180;
      fire("pointermove", x + Math.cos(bearing) * 70, y + Math.sin(bearing) * 70);
      moves += 1;
      await rest(3);
    }
    // Vertical pass: straight up and back down.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let step = 0; step <= 60; step += 1) {
        const share = pass === 0 ? step / 60 : 1 - step / 60;
        fire("pointermove", x - 8, y - Math.round(share * 190));
        moves += 1;
        await rest(3);
      }
    }
    // Park up-and-left, which selects in every variant: a bearing inside the
    // arc, the correct side and a row band for the column, and enough upward
    // travel for the dial. Without this the sweep ends back in the dead zone
    // and every photograph shows an unselected surface.
    fire("pointermove", x - 70, y - 70);
    moves += 1;
    await rest(160);

    const named = document.querySelector("#surface .on .name")
      ?? document.querySelector("#surface .knob-chip:not(.idle) .name")
      ?? document.querySelector("#surface .radial-hub:not(.idle) .name")
      ?? document.querySelector("#surface .caption:not(.empty)");
    return nodes.length + " targets, " + rebuilds + " element rebuilds / " + textSwaps
      + " text swaps over " + moves + " moves, holding " + (named === null ? "nothing" : named.textContent);
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
