/**
 * Measure the transcript reading column in the running instance.
 *
 * Run through ./measure-column.sh, which provides chromium and node via Nix.
 *
 * Screenshots cannot tell a 589px column from a 608px one, and the whole point
 * of Phase 2 is whether --calm-measure caps the width. This drives Chrome over
 * CDP, pierces the shadow roots, and reports real numbers.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const require = createRequire("/home/simonwjackson/code/sandbox/forgerie/package.json");
const WebSocket = require("ws");

const BASE = process.env["FORGERIE_BASE"] ?? "http://127.0.0.1:8504";
const PROJECT = process.env["FORGERIE_PROJECT"] ?? "597a5ae5-0921-4680-a78b-c6355f1fd593";
const WORKSPACE = process.env["FORGERIE_WORKSPACE"] ?? "bfa36da0d1f5";
const SESSION = process.argv[2];
const WIDTH = Number(process.argv[3] ?? 979);
const HEIGHT = Number(process.argv[4] ?? 739);
const PORT = 9333;

if (SESSION === undefined) {
  console.error("usage: measure-column.mjs <session-id> [width] [height]");
  process.exit(1);
}

const url = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}`;

const chrome = spawn("chromium", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  url,
], { stdio: "ignore" });

const probe = `(() => {
  const deepFind = (root, selector) => {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    const hosts = root.querySelectorAll("*");
    for (const host of hosts) {
      if (!host.shadowRoot) continue;
      const found = deepFind(host.shadowRoot, selector);
      if (found) return found;
    }
    return null;
  };

  const chat = deepFind(document, ".chat");
  if (!chat) return { error: "no .chat found" };
  const wrap = chat.closest(".chat-wrap");
  const child = chat.querySelector("article.msg, details.msg, .history-boundary");
  if (!child) return { error: "no transcript child found" };

  const cs = getComputedStyle(child);
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    measureToken: getComputedStyle(document.documentElement).getPropertyValue("--calm-measure").trim(),
    wrapWidth: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
    wrapContainerType: wrap ? getComputedStyle(wrap).containerType : null,
    chatContentWidth: Math.round(chat.clientWidth - parseFloat(getComputedStyle(chat).paddingLeft) - parseFloat(getComputedStyle(chat).paddingRight)),
    childTag: child.tagName.toLowerCase() + "." + String(child.className).split(" ").join("."),
    childWidth: Math.round(child.getBoundingClientRect().width),
    childMaxWidth: cs.maxWidth,
    childMarginInline: cs.marginLeft + " / " + cs.marginRight,
    fontSize: cs.fontSize,
  };
})()`;

const rpc = (ws, id, method, params) =>
  new Promise((resolve) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id !== id) return;
      ws.off("message", onMessage);
      resolve(msg.result);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });

try {
  let targets;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = (await res.json()).filter((t) => t.type === "page" && t.url.startsWith(BASE));
      if (targets.length > 0) break;
    } catch {
      // devtools not up yet
    }
  }
  if (targets === undefined || targets.length === 0) throw new Error("no page target");

  // Let the transcript load and settle.
  await sleep(9000);

  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve) => ws.on("open", resolve));
  const result = await rpc(ws, 1, "Runtime.evaluate", { expression: probe, returnByValue: true });
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
} finally {
  chrome.kill();
}
