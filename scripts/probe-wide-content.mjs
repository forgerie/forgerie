#!/usr/bin/env node
// Measures where wide content (tables, code blocks) actually lands relative to
// the reading column, so the bleed either side of the column can be checked
// rather than eyeballed.
//
//   node scripts/probe-wide-content.mjs --url "http://127.0.0.1:8505/?project=...&session=..."
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "./lib/cdp.mjs";

const POSTURES = [
  { name: "unfolded-portrait", width: 739, height: 979 },
  { name: "unfolded-landscape", width: 979, height: 739 },
];

const TABLE = [
  "| Option | Change | Effect | Notes |",
  "| --- | --- | --- | --- |",
  "| A | Raise the cap, 32rem to 38rem | Fills to 608px; unused space drops | Prose lines grow past 75 characters |",
  "| B | Raise the type, 14px to 16px | Column stays 512px but holds fewer words | The measure stops looking thin |",
  "| C | Let wide content break the measure | Fixes a real defect: tables scroll horizontally | Prose stays capped |",
].join("\n");

const SETUP = `
  (() => {
    const walk = (root, test) => {
      for (const element of root.querySelectorAll("*")) {
        if (test(element)) return element;
        if (element.shadowRoot) {
          const found = walk(element.shadowRoot, test);
          if (found) return found;
        }
      }
      return undefined;
    };
    const view = walk(document, (element) => element.tagName === "CHAT-VIEW");
    if (!view) return "no chat-view";
    let held = view.messages.slice();
    Object.defineProperty(view, "messages", { configurable: true, get: () => held, set: () => undefined });
    window.__probe = {
      view,
      chat: () => view.renderRoot.querySelector(".chat"),
      baseline: held.slice(),
      inject: (messages) => {
        const previous = held;
        held = messages;
        view.requestUpdate("messages", previous);
        return view.updateComplete;
      },
    };
    return "ok";
  })()
`;

function measureScript(messages) {
  return `
    (async () => {
      const probe = window.__probe;
      await probe.inject(${JSON.stringify(messages)});
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const chat = probe.chat();
      const articles = [...chat.querySelectorAll("article.msg")];
      const article = articles[articles.length - 1];
      const formatted = article.querySelector("formatted-text");
      const scroll = formatted.shadowRoot.querySelector(".table-scroll");
      const table = scroll.querySelector("table");
      const box = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      };
      const chain = [];
      for (let node = scroll; node !== null && node !== chat; node = node.parentElement ?? node.getRootNode().host ?? null) {
        const style = getComputedStyle(node);
        chain.push(node.tagName.toLowerCase() + "." + String(node.className || "-") + " " + JSON.stringify(box(node))
          + " display=" + style.display + " width=" + style.width + " maxWidth=" + style.maxWidth + " margin=" + style.marginLeft + "/" + style.marginRight);
      }
      return {
        chain,
        column: box(article),
        scroller: box(scroll),
        table: box(table),
        tableScrollWidth: Math.round(table.scrollWidth),
        overflows: scroll.scrollWidth > scroll.clientWidth + 1,
        bleed: getComputedStyle(chat).getPropertyValue("--calm-bleed").trim(),
        measure: getComputedStyle(chat).getPropertyValue("--calm-measure").trim(),
        chatWidth: Math.round(chat.getBoundingClientRect().width),
      };
    })()
  `;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN.");
  if (args.url === undefined) fail("--url is required");

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-wide-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));

  try {
    await waitForDebugger(debugPort);
    for (const posture of POSTURES) {
      const cdp = await openPage(debugPort);
      try {
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: posture.width, height: posture.height, deviceScaleFactor: 1, mobile: true });
        const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
        await cdp.send("Page.navigate", { url: args.url });
        await loaded;
        await sleep(args.settle);
        const ready = await evaluate(cdp, SETUP);
        if (ready !== "ok") fail(`setup failed: ${String(ready)}`);
        const history = await evaluate(cdp, `JSON.parse(JSON.stringify(window.__probe.baseline))`);
        const messages = [...history, { role: "assistant", parts: [{ type: "text", text: `Measured across three postures:\n\n${TABLE}\n` }] }];
        const result = await evaluate(cdp, measureScript(messages));
        report(posture, result);
        if (args.shots !== undefined) {
          await mkdir(args.shots, { recursive: true });
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          await writeFile(join(args.shots, `${posture.name}.png`), Buffer.from(data, "base64"));
        }
      } finally {
        cdp.close();
      }
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function report(posture, r) {
  const leftBleed = r.column.left - r.scroller.left;
  const rightBleed = r.scroller.right - r.column.right;
  process.stdout.write(
    `\n== ${posture.name} (${String(posture.width)}x${String(posture.height)})\n`
    + `  chat=${String(r.chatWidth)} measure=${r.measure} bleed=${r.bleed}\n`
    + `  column   ${String(r.column.left)}..${String(r.column.right)} (${String(r.column.width)})\n`
    + `  scroller ${String(r.scroller.left)}..${String(r.scroller.right)} (${String(r.scroller.width)})\n`
    + `  bleed used: left=${String(leftBleed)} right=${String(rightBleed)}${leftBleed === rightBleed ? "" : "   << ASYMMETRIC"}\n`
    + `  table wants ${String(r.tableScrollWidth)}px, scrolls=${String(r.overflows)}\n`
    + r.chain.map((entry) => `    ${entry}\n`).join(""),
  );
}

function parseArgs(argv) {
  const parsed = { settle: 6000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else if (arg === "--settle") parsed.settle = Number(argv[++i]);
    else if (arg === "--shots") parsed.shots = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
