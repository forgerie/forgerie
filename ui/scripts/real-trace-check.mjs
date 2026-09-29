#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
// Read-only check against a real session: every tool call in history renders as
// exactly one tool line, reasoning blocks match, and a screenshot is saved to
// ignored local evidence. Sends nothing.
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
const app = process.env.APP_URL ?? "http://127.0.0.1:8510/";
const out = resolve("verification/local/real-trace");
await mkdir(out, { recursive: true });

const catalog = await (await fetch(new URL("/api/sessions/all", app))).json();
const session = catalog.sessions.find((item) => item.id === id);
assert.ok(session, "Session must exist");
const page = await (await fetch(new URL(`/api/sessions/${encodeURIComponent(id)}/messages?${new URLSearchParams({ cwd: session.cwd })}`, app))).json();
const parts = page.messages.flatMap((message) => message.role === "assistant" && Array.isArray(message.content) ? message.content : []);
const expected = {
  toolCalls: new Set(parts.filter((part) => part.type === "toolCall").map((part) => part.id)).size,
  toolResults: page.messages.filter((message) => message.role === "toolResult").length,
  failedResults: page.messages.filter((message) => message.role === "toolResult" && message.isError).length,
  thinkingParts: parts.filter((part) => part.type === "thinking" && part.thinking.trim() !== "").length,
};

const profile = await mkdtemp(join(tmpdir(), "aui-real-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
const chrome = launchChrome(chromeBin, port, profile);
const result = { expected, errors: [] };
try {
  await waitForDebugger(port);
  const cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[0], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  await cdp.send("Page.navigate", { url: `${app}?${new URLSearchParams({ session: id })}` });
  const deadline = Date.now() + 60_000;
  while (!(await evaluate(cdp, `document.querySelector('.connection-status')?.textContent === "Connected" && document.querySelectorAll('.message').length > 0`))) {
    assert.ok(Date.now() < deadline, "Session did not load");
    await sleep(100);
  }
  await sleep(500);
  // Each tool line shows one call; stopped lines are calls without a result.
  result.rendered = await evaluate(cdp, `(() => {
    const cards = [...document.querySelectorAll("details.tool-call")];
    const label = (node) => node.querySelector(":scope > summary .trace-label").textContent;
    return {
      toolLines: cards.length,
      byLabel: cards.reduce((acc, node) => ({ ...acc, [label(node)]: (acc[label(node)] ?? 0) + 1 }), {}),
      groups: document.querySelectorAll("details.tool-group").length,
      reasoningBlocks: document.querySelectorAll("details.reasoning").length,
      reasoningParts: document.querySelectorAll("details.reasoning .reasoning-text > .markdown").length,
      assistantReplies: document.querySelectorAll(".message-assistant").length,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`);
  // Open the first group and its first card, then capture that region.
  await evaluate(cdp, `(() => {
    const group = document.querySelector("details.tool-group");
    if (group) group.open = true;
    const card = (group ?? document).querySelector("details.tool-call");
    if (card) card.open = true;
    (group ?? card)?.scrollIntoView({ block: "start" });
    return true;
  })()`);
  await sleep(400);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, "real-session-open-group.png"), Buffer.from(shot.data, "base64"));
} finally {
  chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
assert.equal(result.rendered.toolLines, expected.toolCalls, "One tool line per call id");
assert.equal(result.rendered.byLabel.failed ?? 0, expected.failedResults, "Failures match");
assert.equal(result.rendered.reasoningParts, expected.thinkingParts, "Every thinking part renders");
assert.deepEqual(result.errors, []);
assert.equal(result.rendered.pageOverflow, false);
