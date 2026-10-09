#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Read-only live check. Opens a session that is running tools, samples the
// rendered trace while it works, then compares tool lines with the API history.
// Sends nothing to the session.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const id = process.env.SESSION_ID;
assert.ok(id, "Set SESSION_ID");
const seconds = Number(process.env.WATCH_SECONDS ?? 90);
const app = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const out = resolve("verification/local/live-trace");
await mkdir(out, { recursive: true });
const catalog = await (await fetch(new URL("/api/sessions/all", app))).json();
const session = catalog.sessions.find((item) => item.id === id);
assert.ok(session, "Session must exist");

const profile = await mkdtemp(join(tmpdir(), "aui-live-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
const chrome = launchChrome(chromeBin, port, profile);
const result = { samples: [], errors: [], frames: {} };
const sample = `(() => {
  const cards = [...document.querySelectorAll("details.tool-call")];
  const labels = cards.map((node) => node.querySelector(":scope > summary .trace-label").textContent);
  return {
    status: document.querySelector(".connection-status")?.textContent,
    toolLines: cards.length,
    open: labels.filter((label) => label === "running" || label === "calling").length,
    stopped: labels.filter((label) => label === "stopped").length,
    working: [...document.querySelectorAll("div.trace-line .trace-text")].filter((node) => node.textContent === "working").length,
    lastTool: cards.at(-1)?.querySelector(":scope > summary .trace-text").textContent.slice(0, 120),
  };
})()`;
try {
  await waitForDebugger(port);
  const cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "light" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  cdp.listeners.set("Network.webSocketFrameReceived", [(event) => {
    try {
      const text = event.response.opcode === 2 ? Buffer.from(event.response.payloadData, "base64").toString() : event.response.payloadData;
      const type = JSON.parse(text).type;
      result.frames[type] = (result.frames[type] ?? 0) + 1;
    } catch { /* non-JSON frame */ }
  }]);
  await cdp.send("Page.navigate", { url: `${app}?${new URLSearchParams({ session: id })}` });
  const end = Date.now() + seconds * 1000;
  let previous = "";
  while (Date.now() < end) {
    const state = await evaluate(cdp, sample);
    const key = JSON.stringify(state);
    if (key !== previous) result.samples.push({ at: new Date().toISOString(), ...state });
    previous = key;
    await sleep(250);
  }
  const page = await (await fetch(new URL(`/api/sessions/${encodeURIComponent(id)}/messages?${new URLSearchParams({ cwd: session.cwd })}`, app))).json();
  const calls = new Set(page.messages.flatMap((message) => message.role === "assistant" && Array.isArray(message.content)
    ? message.content.filter((part) => part.type === "toolCall").map((part) => part.id) : []));
  const results = new Set(page.messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId));
  result.final = { ...(await evaluate(cdp, sample)), apiToolCalls: calls.size, apiOpenCalls: [...calls].filter((call) => !results.has(call)).length };
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, "live-final.png"), Buffer.from(shot.data, "base64"));
} finally {
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ final: result.final, frames: result.frames, samples: result.samples.length, maxOpen: Math.max(...result.samples.map((s) => s.open)), errors: result.errors }, null, 2));
