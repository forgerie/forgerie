#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { hitRect } from "./lib/hit.mjs";

// Compare rendered Markdown with an independent parse of the backend source.
const normalize = (text) => text.replace(/\s+/g, " ").trim();
// Renderers split Markdown blocks differently. Compare semantic block text,
// not incidental newline text nodes between react-markdown's elements.
function blockText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  const text = [...node.childNodes].map(blockText).join("");
  return /^(P|H[1-6]|LI|TH|TD|PRE|BLOCKQUOTE|HR)$/.test(node.nodeName) ? ` ${text} ` : text;
}

const repo = process.env.FORGERIE_ROOT ?? resolve("../..");
const { findChrome, launchChrome, getFreePort, waitForDebugger, evaluate, sleep } = await import(pathToFileURL(join(repo, "scripts/lib/cdp.mjs")));
const { openPosturePage } = await import(pathToFileURL(join(repo, "scripts/lib/posture-page.mjs")));
const { FOLD8_POSTURES } = await import(pathToFileURL(join(repo, "scripts/lib/fold8-postures.mjs")));
const id = process.env.SESSION_ID;
if (!id) throw new Error("SESSION_ID must name an existing idle test session.");
const url = `${process.env.APP_URL ?? "http://127.0.0.1:8510/"}?${new URLSearchParams({ session: id })}`;
const shouldSend = process.argv.includes("--send");
const output = resolve("verification/local");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "aui-mvp-chrome-"));
const port = await getFreePort();
// The shared helper uses a login shell, which can discard a Nix shell's PATH.
const chromeBin = process.env.CHROME_BIN || spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout?.trim() || findChrome();
if (!chromeBin) throw new Error("Chromium not found.");
const chrome = launchChrome(chromeBin, port, profile);
let cdp;
const result = { url, historyMessages: 0, deltaFrames: 0, visiblePartial: false, sent: false, transitions: [], errors: [] };
try {
  await waitForDebugger(port);
  cdp = await openPosturePage({ debugPort: port, posture: FOLD8_POSTURES[2], colorScheme: "dark" });
  await cdp.send("Network.enable");
  cdp.listeners.set("Runtime.exceptionThrown", [(event) => result.errors.push(event.exceptionDetails.text)]);
  cdp.listeners.set("Network.webSocketFrameReceived", [(event) => {
    try {
      const payload = event.response.opcode === 2 ? Buffer.from(event.response.payloadData, "base64").toString() : event.response.payloadData;
      const value = JSON.parse(payload);
      if (value.type === "assistant.delta") result.deltaFrames += 1;
    } catch { /* Other frames are outside this acceptance assertion. */ }
  }]);
  const promptBodies = [];
  cdp.listeners.set("Network.requestWillBeSent", [(event) => {
    if (event.request.url.endsWith("/prompt")) promptBodies.push(JSON.parse(event.request.postData));
  }]);
  await cdp.send("Page.navigate", { url });
  const read = () => evaluate(cdp, `({
    status: document.querySelector('.connection-status')?.textContent,
    messages: [...document.querySelectorAll('.message-text')].map(e => e.textContent),
    // Assistant text parts. A joined reply also holds reasoning and tool lines, and can end without text.
    assistantMessages: [...document.querySelectorAll('.message-assistant .message-text > .markdown')].map(e => {
      const content = e.cloneNode(true);
      content.querySelectorAll('.code-header').forEach(header => header.remove());
      return (${blockText})(content).replace(/\\s+/g, ' ').trim();
    }),
    draft: document.querySelector('[data-composer-input]')?.value,
    alert: document.querySelector('[role=alert]')?.textContent,
    width: innerWidth, height: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
    send: document.querySelector('button[aria-label="Send message"]')?.getBoundingClientRect().toJSON(),
    sendHit: (() => { const node = document.querySelector('button[aria-label="Send message"]'); return node ? (${hitRect})(node) : undefined; })(),
    composer: document.querySelector('.composer')?.getBoundingClientRect().toJSON()
  })`);
  async function until(test, timeout = 120_000) {
    const deadline = Date.now() + timeout;
    let state;
    while (Date.now() < deadline) {
      state = await read();
      if (state.alert) throw new Error(state.alert);
      if (test(state)) return state;
      await sleep(40);
    }
    const last = { status: state?.status, messages: state?.messages.length, lastAssistant: state?.assistantMessages.at(-1)?.slice(0, 300) };
    throw new Error(`Acceptance state timed out: ${JSON.stringify(last)}`);
  }
  let state = await until((s) => s.status === "Connected");
  const catalogResponse = await fetch(new URL("/api/sessions/all", url));
  const catalog = await catalogResponse.json();
  const session = catalog.sessions.find((item) => item.id === id);
  assert.ok(session, "Session must still exist");
  async function finalBackendText() {
    const response = await fetch(new URL(`/api/sessions/${encodeURIComponent(id)}/messages?${new URLSearchParams({ cwd: session.cwd })}`, url));
    assert.equal(response.status, 200);
    const page = await response.json();
    const texts = page.messages.filter((message) => message.role === "assistant").map((message) =>
      typeof message.content === "string" ? message.content
        : (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n"));
    const text = texts.filter((text) => text !== "").at(-1);
    const html = renderToStaticMarkup(createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm], children: text,
      components: { img: ({ alt }) => createElement("span", null, alt || "Image") },
    }));
    return normalize(await evaluate(cdp, `(() => {
      const node = document.createElement('div');
      node.innerHTML = ${JSON.stringify(html)};
      return (${blockText})(node);
    })()`));
  }
  const originalReply = await finalBackendText();
  state = await until((s) => s.messages.length > 0 && s.assistantMessages.at(-1) === originalReply);
  result.historyMessages = state.messages.length;
  assert.ok(result.historyMessages > 0, "Expected existing history");
  if (shouldSend) {
    await evaluate(cdp, `document.querySelector('[data-composer-input]').focus()`);
    await cdp.send("Input.insertText", { text: "hello" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until((s) => {
      if (s.status === "Running" && s.messages.length > result.historyMessages + 1 && s.messages.at(-1).length > 0) result.visiblePartial = true;
      return result.deltaFrames > 0 && s.status === "Connected" && s.messages.length >= result.historyMessages + 2;
    });
    assert.equal(promptBodies.length, 1, "Expected exactly one prompt");
    assert.equal(promptBodies[0].text, "hello");
    assert.equal(typeof promptBodies[0].cwd, "string");
    assert.ok(result.visiblePartial, "Expected partial text visible before completion");
    result.sent = true;
    result.prompt = promptBodies[0];
    const finalReply = await finalBackendText();
    state = await until((s) => s.assistantMessages.at(-1) === finalReply);
    result.finalReply = state.messages.at(-1);
    assert.equal(state.messages.filter((text, index) => index >= result.historyMessages && text === "hello").length, 1);
    assert.equal(state.messages.length, result.historyMessages + 2, "Expected one user and one assistant message");
  }
  await evaluate(cdp, `document.querySelector('[data-composer-input]').focus()`);
  await cdp.send("Input.insertText", { text: "Unsent draft survives rotation" });
  for (const posture of FOLD8_POSTURES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 2.625, mobile: true });
    await sleep(100);
    state = await read();
    assert.equal(state.draft, "Unsent draft survives rotation");
    assert.equal(state.width, posture.width);
    assert.equal(state.overflow, false);
    assert.ok(state.send && state.send.x >= 0 && state.send.right <= state.width && state.send.bottom <= state.height);
    assert.ok(state.sendHit.height >= 44 && state.sendHit.width >= 44, "Send target must stay reachable");
    result.transitions.push({ posture: posture.name, width: state.width, height: state.height, send: state.send });
  }
  const loaded = cdp.waitForEvent("Page.loadEventFired", 20_000);
  await cdp.send("Page.reload");
  await loaded;
  state = await until((s) => s.status === "Connected" && s.messages.length === result.historyMessages + (shouldSend ? 2 : 0));
  result.reloadMessages = state.messages.length;
  assert.equal(state.messages.length, result.historyMessages + (shouldSend ? 2 : 0), "Reload must not duplicate messages");
  const restoredReply = await finalBackendText();
  await until((s) => s.assistantMessages.at(-1) === restoredReply);
  result.matchesBackendHistory = true;
  assert.deepEqual(result.errors, []);
  await writeFile(join(output, shouldSend ? "hello.json" : "history.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close(); chrome.kill("SIGTERM"); await sleep(300);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
