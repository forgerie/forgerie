/**
 * Report the computed tone and weight the transcript actually gives a user
 * message versus a reply.
 *
 * The distinction is the whole basis for dropping role labels, and it renders
 * through a nested <formatted-text> shadow root, so it has to be read from
 * computed style rather than judged from a screenshot.
 *
 * Run through ./contrast-probe.sh.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const require = createRequire("/home/simonwjackson/code/sandbox/forgerie/package.json");
const WebSocket = require("ws");

const BASE = process.env["FORGERIE_BASE"] ?? "http://127.0.0.1:8504";
const PROJECT = process.env["FORGERIE_PROJECT"] ?? "597a5ae5-0921-4680-a78b-c6355f1fd593";
const WORKSPACE = process.env["FORGERIE_WORKSPACE"] ?? "bfa36da0d1f5";
const session = process.argv[2];
const PORT = 9335;

if (session === undefined) {
  console.error("usage: contrast-probe.mjs <session>");
  process.exit(1);
}

const url = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${session}`;

const chrome = spawn("chromium", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  "--window-size=739,979",
  url,
], { stdio: "ignore" });

const probe = `(() => {
  const deepFind = (root, selector) => {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const host of root.querySelectorAll("*")) {
      if (!host.shadowRoot) continue;
      const found = deepFind(host.shadowRoot, selector);
      if (found) return found;
    }
    return null;
  };
  const chat = deepFind(document, ".chat");
  if (!chat) return { error: "no .chat" };

  const describe = (role) => {
    const msg = chat.querySelector("article.msg." + role);
    if (!msg) return { role, error: "not present" };
    const msgStyle = getComputedStyle(msg);
    const ft = msg.querySelector("formatted-text");
    const para = ft && ft.shadowRoot ? ft.shadowRoot.querySelector(".formatted p, .formatted") : null;
    const paraStyle = para ? getComputedStyle(para) : null;
    return {
      role,
      messageColor: msgStyle.color,
      messageWeight: msgStyle.fontWeight,
      renderedColor: paraStyle ? paraStyle.color : "(no formatted-text)",
      renderedWeight: paraStyle ? paraStyle.fontWeight : "(no formatted-text)",
    };
  };

  return {
    theme: document.documentElement.dataset.piWebTheme,
    calmInk: getComputedStyle(document.documentElement).getPropertyValue("--calm-ink").trim(),
    calmInkMuted: getComputedStyle(document.documentElement).getPropertyValue("--calm-ink-muted").trim(),
    user: describe("user"),
    assistant: describe("assistant"),
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

  await sleep(9000);
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve) => ws.on("open", resolve));
  const result = await rpc(ws, 1, "Runtime.evaluate", { expression: probe, returnByValue: true });
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
} finally {
  chrome.kill();
}
