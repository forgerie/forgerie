/**
 * Check the two Phase 7 behaviours on a session that is actually running.
 *
 * Both only exist mid-turn, so an idle session cannot exercise them: the live
 * tail must stay closed while activity streams in, and the liveness line must
 * report elapsed time plus the current step. Reads state only.
 *
 * Run through ./liveness-probe.sh.
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
const PORT = 9336;

if (session === undefined) {
  console.error("usage: liveness-probe.mjs <session>");
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

  const liveness = chat.querySelector("transcript-liveness");
  const groups = [...chat.querySelectorAll("details.msg.event-group")];
  const liveGroups = groups.filter((g) => g.classList.contains("live"));

  return {
    livenessPresent: liveness !== null,
    livenessText: liveness && liveness.shadowRoot
      ? (liveness.shadowRoot.textContent ?? "").trim().replace(/\\s+/g, " ")
      : null,
    groupCount: groups.length,
    liveGroupCount: liveGroups.length,
    liveGroupsOpen: liveGroups.map((g) => g.open),
    liveGroupSummary: liveGroups.length > 0
      ? (liveGroups[0].querySelector("summary")?.textContent ?? "").trim().replace(/\\s+/g, " ")
      : null,
    openGroupCount: groups.filter((g) => g.open).length,
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

  const first = await rpc(ws, 1, "Runtime.evaluate", { expression: probe, returnByValue: true });
  console.log("t0", JSON.stringify(first.result.value));

  // A second read four seconds later shows whether the elapsed count advances.
  await sleep(4000);
  const second = await rpc(ws, 2, "Runtime.evaluate", { expression: probe, returnByValue: true });
  console.log("t1", JSON.stringify(second.result.value));

  ws.close();
} finally {
  chrome.kill();
}
