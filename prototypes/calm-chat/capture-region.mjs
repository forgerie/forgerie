/**
 * Screenshot the transcript scrolled to a named landmark.
 *
 * The transcript opens pinned to the newest message, which is usually mid-reply.
 * Reviewing user/assistant contrast, the activity fold, and system notices needs
 * the scroller parked somewhere specific, so this drives it over CDP.
 *
 * Run through ./capture-region.sh.
 *   landmark: "fold" | "fold-open" | "user" | "system"
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const require = createRequire("/home/simonwjackson/code/sandbox/forgerie/package.json");
const WebSocket = require("ws");

const BASE = process.env["FORGERIE_BASE"] ?? "http://127.0.0.1:8504";
const PROJECT = process.env["FORGERIE_PROJECT"] ?? "597a5ae5-0921-4680-a78b-c6355f1fd593";
const WORKSPACE = process.env["FORGERIE_WORKSPACE"] ?? "bfa36da0d1f5";
const [session, landmark = "fold", out = "live/region.png", widthArg, heightArg] = process.argv.slice(2);
const WIDTH = Number(widthArg ?? 739);
const HEIGHT = Number(heightArg ?? 979);
const PORT = 9334;

if (session === undefined) {
  console.error("usage: capture-region.mjs <session> <landmark> <out.png> [w] [h]");
  process.exit(1);
}

const url = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${session}`;

const chrome = spawn("chromium", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  url,
], { stdio: "ignore" });

const scrollScript = (target) => `(() => {
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

  const selectors = {
    fold: "details.msg.event-group",
    "fold-open": "details.msg.event-group",
    user: "article.msg.user",
    system: "article.msg.system",
  };
  const nodes = [...chat.querySelectorAll(selectors[${JSON.stringify(target)}] ?? "article.msg")];
  if (nodes.length === 0) return { error: "landmark not found", landmark: ${JSON.stringify(target)} };

  const node = nodes[Math.floor(nodes.length / 2)];
  if (${JSON.stringify(target)} === "fold-open" && node.tagName === "DETAILS") node.open = true;

  const top = node.getBoundingClientRect().top - chat.getBoundingClientRect().top + chat.scrollTop;
  chat.scrollTop = Math.max(0, top - 40);
  return { ok: true, count: nodes.length, scrollTop: Math.round(chat.scrollTop) };
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

  // The theme resolves once at startup, so emulating prefers-color-scheme after
  // load does nothing. Write the app's own stored preference and reload, which
  // exercises the real theme path rather than a browser-level override.
  // Any known scheme, not just dark. Emulation.setEmulatedMedia does not work
  // here: the theme resolves once at startup, so it has to be stored and the
  // page reloaded.
  const scheme = process.env["FORGERIE_SCHEME"];
  if (scheme === "dark" || scheme === "light") {
    await rpc(ws, 3, "Runtime.evaluate", {
      expression: `localStorage.setItem("pi-web-app-theme", JSON.stringify({ themeId: "themes:pi-web-${scheme}", auto: false }))`,
      returnByValue: true,
    });
    await rpc(ws, 4, "Page.reload", {});
    await sleep(9000);
  }

  const scrolled = await rpc(ws, 1, "Runtime.evaluate", { expression: scrollScript(landmark), returnByValue: true });
  console.log(landmark, JSON.stringify(scrolled.result.value));

  await sleep(1200);
  const shot = await rpc(ws, 2, "Page.captureScreenshot", { format: "png" });
  await writeFile(out, Buffer.from(shot.data, "base64"));
  console.log(`wrote ${out}`);
  ws.close();
} finally {
  chrome.kill();
}
