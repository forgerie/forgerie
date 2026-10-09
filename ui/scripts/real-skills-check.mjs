#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node
// Read-only check against a real session: every `/skill:` invocation in history
// renders as one command record, every SKILL.md read renders as one skill load
// outside the tool activity, and no raw skill block reaches a bubble. Sends nothing.
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
const out = resolve("verification/local/real-skills");
await mkdir(out, { recursive: true });

const catalog = await (await fetch(new URL("/api/sessions/all", app))).json();
const session = catalog.sessions.find((item) => item.id === id);
assert.ok(session, "Session must exist");
const page = await (await fetch(new URL(`/api/sessions/${encodeURIComponent(id)}/messages?${new URLSearchParams({ cwd: session.cwd })}`, app))).json();
const block = /^<skill name="([^"]+)" location="([^"]+)">\n[\s\S]*?\n<\/skill>(?:\n\n[\s\S]+)?$/;
const textsOf = (message) => typeof message.content === "string" ? [message.content]
  : (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text);
const isSkillRead = (part) => part.type === "toolCall" && part.name === "read" && /[\\/]SKILL\.md$/.test(String(part.arguments?.path ?? ""));
const assistantParts = page.messages.flatMap((message) => message.role === "assistant" && Array.isArray(message.content) ? message.content : []);
const expected = {
  invocations: page.messages.filter((message) => message.role === "user" && textsOf(message).length === 1 && block.test(textsOf(message)[0])).length,
  skillLoads: new Set(assistantParts.filter(isSkillRead).map((part) => part.id)).size,
  otherToolCalls: new Set(assistantParts.filter((part) => part.type === "toolCall" && !isSkillRead(part)).map((part) => part.id)).size,
};

const profile = await mkdtemp(join(tmpdir(), "aui-real-skills-"));
const port = await getFreePort();
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim();
const chrome = launchChrome(chromeBin, port, profile);
const result = { session: id, expected, errors: [], mutations: [] };
try {
  await waitForDebugger(port);
  const cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  await cdp.send("Network.enable");
  cdp.listeners.set("Network.requestWillBeSent", [(event) => { if (event.request.method !== "GET") result.mutations.push(event.request.url); }]);
  await cdp.send("Page.navigate", { url: `${app}?${new URLSearchParams({ session: id })}` });
  const deadline = Date.now() + 60_000;
  while (!(await evaluate(cdp, `document.querySelector('.connection-status')?.textContent === "Connected" && document.querySelectorAll('.message').length > 0`))) {
    assert.ok(Date.now() < deadline, "Session did not load");
    await sleep(100);
  }
  await sleep(800);
  result.rendered = await evaluate(cdp, `({
    invocations: document.querySelectorAll(".message-user details.skill-invocation").length,
    skillLoads: document.querySelectorAll("details.skill-load").length,
    loadsInsideActivity: document.querySelectorAll("details.chain-of-thought details.skill-load").length,
    otherToolCalls: document.querySelectorAll("details.tool-call").length,
    rawBlocksInBubbles: [...document.querySelectorAll(".user-bubble")].filter((node) => node.textContent.includes("<skill name=")).length,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  })`);
  assert.equal(result.rendered.invocations, expected.invocations, "one record per invocation");
  assert.equal(result.rendered.skillLoads, expected.skillLoads, "one record per skill load");
  assert.equal(result.rendered.otherToolCalls, expected.otherToolCalls, "every other call stays a tool");
  assert.equal(result.rendered.loadsInsideActivity, 0);
  assert.equal(result.rendered.rawBlocksInBubbles, 0);
  assert.equal(result.rendered.pageOverflow, false);
  // Open the last invocation and the last load group, then capture them.
  await evaluate(cdp, `(() => {
    const invocation = [...document.querySelectorAll(".skill-invocation")].at(-1);
    if (invocation) invocation.open = true;
    const loads = [...document.querySelectorAll("details.skill-loads, details.skill-load")].at(-1);
    if (loads) loads.open = true;
    invocation?.scrollIntoView({ block: "start" });
    return true;
  })()`);
  await sleep(500);
  // Records keep their open state while the live session keeps publishing.
  result.openAfterSettle = await evaluate(cdp, `({
    invocation: [...document.querySelectorAll(".skill-invocation")].at(-1)?.open ?? null,
    invocationText: !![...document.querySelectorAll(".skill-invocation")].at(-1)?.querySelector("pre"),
    load: [...document.querySelectorAll("details.skill-loads, details.skill-load")].at(-1)?.open ?? null,
  })`);
  // Opening grows the transcript, so bring the opened command back into view before the capture.
  result.capturedTop = await evaluate(cdp, `(() => { const node = [...document.querySelectorAll(".skill-invocation")].at(-1);
    node?.scrollIntoView({ block: "start" }); return Math.round(node?.getBoundingClientRect().top ?? -1); })()`);
  await sleep(300);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, "real-session-skills.png"), Buffer.from(shot.data, "base64"));
  assert.deepEqual(result.mutations, []);
  assert.deepEqual(result.errors, []);
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ expected, rendered: result.rendered, openAfterSettle: result.openAfterSettle, mutations: 0, errors: 0 }));
} finally {
  chrome.kill();
  await sleep(200);
  await rm(profile, { recursive: true, force: true });
}
