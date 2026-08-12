#!/usr/bin/env node
/**
 * Measure the transcript's content column against the composer's text origin.
 *
 * Alignment is a layout fact, not something a screenshot can settle to the
 * pixel: this drives a real browser through the DevTools protocol and reports
 * the edges the eye is supposed to track.
 *
 * Usage: measure-column.mjs <url> [width]x[height] ...
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(join(process.cwd(), "package.json"));
const WebSocket = require("ws");

const url = process.argv[2];
const viewports = process.argv.slice(3);
if (url === undefined || viewports.length === 0) {
  console.error("usage: measure-column.mjs <url> <width>x<height> [...]");
  process.exit(2);
}

const MEASURE = `(() => {
  const app = document.querySelector("pi-web-app");
  const root = app.shadowRoot;
  const chatView = root.querySelector("chat-view");
  const chat = chatView?.shadowRoot.querySelector(".chat");
  const editor = root.querySelector("prompt-editor");
  const footer = editor?.shadowRoot.querySelector("footer");
  const line = editor?.shadowRoot.querySelector(".cm-line, .cm-placeholder");
  const roots = [...(chat?.querySelectorAll(".msg.assistant formatted-text, .msg.assistant > formatted-text") ?? [])].map((el) => el.shadowRoot);
  const edges = (selector) => [...new Set(roots.flatMap((r) => [...r.querySelectorAll(selector)].map((el) => Math.round(el.getBoundingClientRect().left))))].sort((a, b) => a - b);
  const prose = roots.flatMap((r) => [...r.querySelectorAll(".formatted > p")])[0];
  const wide = roots.flatMap((r) => [...r.querySelectorAll(".table-scroll, .formatted > pre")])[0];
  const box = (el) => (el === null || el === undefined ? null : (({ left, right, width }) => ({ left: Math.round(left * 100) / 100, right: Math.round(right * 100) / 100, width: Math.round(width * 100) / 100 }))(el.getBoundingClientRect()));
  const chatStyle = chat === null || chat === undefined ? null : getComputedStyle(chat);
  const probe = (host, expression) => {
    if (host === null || host === undefined) return null;
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;visibility:hidden;height:0;inline-size:" + expression;
    host.append(el);
    const width = Math.round(el.getBoundingClientRect().width * 100) / 100;
    el.remove();
    return width;
  };
  return {
    viewport: window.innerWidth,
    scrollWidth: document.scrollingElement.scrollWidth,
    main: box(root.querySelector("main")),
    chatWrap: box(chatView?.shadowRoot.querySelector(".chat-wrap")),
    editorHost: box(editor),
    columnLeft: chat === null || chat === undefined ? null : Math.round((chat.getBoundingClientRect().left + parseFloat(chatStyle.paddingLeft)) * 100) / 100,
    columnToken: chatStyle?.getPropertyValue("--calm-column").trim() ?? null,
    probes: {
      chatColumn: probe(chat, "var(--calm-column)"),
      chatMeasure: probe(chat, "var(--calm-measure)"),
      chatWideRun: probe(chat, "var(--calm-wide-run)"),
      proseHostColumn: probe(prose?.parentElement, "var(--calm-column)"),
      proseHostWideRun: probe(prose?.parentElement, "var(--calm-wide-run)"),
      islandColumn: probe(footer, "var(--calm-column)"),
      islandInset: probe(footer, "var(--composer-text-inset)"),
    },
    prose: box(prose),
    proseLefts: edges(".formatted > p"),
    wideBlock: box(wide),
    wideLefts: edges(".table-scroll, .formatted > pre"),
    footer: box(footer),
    textOrigin: box(line),
  };
})()`;

const profile = await mkdtemp(join(tmpdir(), "forgerie-measure-"));
const chrome = spawn("chromium", [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--remote-debugging-port=9333",
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const targetsUrl = "http://127.0.0.1:9333/json";
let target;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(`${targetsUrl}/list`);
    const list = await response.json();
    target = list.find((entry) => entry.type === "page");
    if (target !== undefined) break;
  } catch {
    // devtools endpoint is not up yet
  }
  await sleep(250);
}
if (target === undefined) {
  chrome.kill();
  throw new Error("chromium devtools endpoint never came up");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

let nextId = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const resolver = pending.get(message.id);
  if (resolver === undefined) return;
  pending.delete(message.id);
  resolver(message);
});
const send = (method, params = {}) => {
  const id = (nextId += 1);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
};

await send("Page.enable");
await send("Runtime.enable");

for (const viewport of viewports) {
  const [width, height] = viewport.split("x").map((value) => Number.parseInt(value, 10));
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(6000);
  const result = await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
  const value = result.result?.result?.value;
  console.log(`\n== ${viewport}`);
  if (value === undefined) {
    console.log("  no measurement", JSON.stringify(result.result));
    continue;
  }
  const gap = value.prose === null || value.textOrigin === null ? null : Math.round((value.textOrigin.left - value.prose.left) * 100) / 100;
  console.log(`  viewport ${value.viewport}  scrollWidth ${value.scrollWidth}`);
  console.log(`  main             ${JSON.stringify(value.main)}`);
  console.log(`  chat wrap        ${JSON.stringify(value.chatWrap)}`);
  console.log(`  editor host      ${JSON.stringify(value.editorHost)}`);
  console.log(`  column left      ${value.columnLeft}`);
  console.log(`  probes           ${JSON.stringify(value.probes)}`);
  console.log(`  prose            ${JSON.stringify(value.prose)}`);
  console.log(`  prose lefts      ${JSON.stringify(value.proseLefts)}`);
  console.log(`  wide block       ${JSON.stringify(value.wideBlock)}`);
  console.log(`  wide lefts       ${JSON.stringify(value.wideLefts)}`);
  console.log(`  island           ${JSON.stringify(value.footer)}`);
  console.log(`  draft text left  ${value.textOrigin === null ? "n/a" : value.textOrigin.left}`);
  console.log(`  text vs prose    ${gap === null ? "n/a" : gap}px`);
}

socket.close();
chrome.kill();
