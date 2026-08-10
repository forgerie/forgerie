/**
 * Report the alignment and tone the transcript actually gives a question
 * versus a reply.
 *
 * Alignment is the cue that tells the two apart, and it has to survive a
 * nested <formatted-text> shadow root, so it has to be read from computed
 * style rather than judged from a screenshot.
 *
 * Run through ./align-probe.sh.
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
const PORT = 9337;

if (session === undefined) {
  console.error("usage: align-probe.mjs <session>");
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

  /*
   * Walks the whole chain from the message down to the paragraph. A paragraph
   * box fills the column whatever its alignment, so measuring its edges proves
   * nothing; only the computed value at each step shows where inheritance
   * stops.
   */
  const readRole = (role) => {
    const host = chat.querySelector("article.msg." + role);
    if (!host) return { role, found: false };
    const formatted = host.querySelector("formatted-text");
    const root = formatted?.shadowRoot?.querySelector(".formatted") ?? undefined;
    const paragraph = root?.querySelector("p") ?? undefined;
    const chain = [
      ["article.msg." + role, host],
      ["formatted-text", formatted],
      [".formatted", root],
      ["p", paragraph],
    ];
    return {
      role,
      found: true,
      color: getComputedStyle(host).color,
      fontWeight: getComputedStyle(host).fontWeight,
      textAlignChain: chain.map(([name, node]) => name + "=" + (node ? getComputedStyle(node).textAlign : "missing")),
      // Where the glyphs actually sit, which is the only honest witness.
      textLeft: paragraph?.firstChild
        ? (() => {
            const range = document.createRange();
            range.selectNodeContents(paragraph);
            const rect = range.getBoundingClientRect();
            const columnBox = chat.getBoundingClientRect();
            return { left: Math.round(rect.left - columnBox.left), right: Math.round(columnBox.right - rect.right) };
          })()
        : null,
    };
  };

  /*
   * The gap between the step count closing one turn and the question opening
   * the next. Screenshots kept landing elsewhere in a long transcript, and the
   * distance is the whole point of the turn gap, so it is measured instead.
   */
  const turnGaps = [];
  const children = [...chat.children];
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (!node.matches("details.msg.event-group")) continue;
    const next = children.slice(index + 1).find((candidate) => candidate.matches("article.msg"));
    if (!next) continue;
    turnGaps.push({
      nextRole: [...next.classList].filter((name) => name !== "msg").join(" "),
      gap: Math.round(next.getBoundingClientRect().top - node.getBoundingClientRect().bottom),
    });
  }

  return {
    themeBg: getComputedStyle(document.body).backgroundColor,
    user: readRole("user"),
    assistant: readRole("assistant"),
    turnGaps: turnGaps.slice(0, 6),
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

  await sleep(12000);
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve) => ws.on("open", resolve));

  const scheme = process.env["FORGERIE_SCHEME"];
  if (scheme === "dark" || scheme === "light") {
    await rpc(ws, 1, "Runtime.evaluate", {
      expression: `localStorage.setItem("pi-web-app-theme", JSON.stringify({ themeId: "themes:pi-web-${scheme}", auto: false }))`,
      returnByValue: true,
    });
    await rpc(ws, 2, "Page.reload", {});
    await sleep(11000);
  }

  const result = await rpc(ws, 3, "Runtime.evaluate", { expression: probe, returnByValue: true });
  console.log(JSON.stringify(result.result.value, null, 2));

  ws.close();
} finally {
  chrome.kill();
}
