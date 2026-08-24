#!/usr/bin/env node
// Measures the vertical anatomy of a session-inbox-panel row against a running
// Forgerie instance, in both input modes.
//
// Mouse mode is the document default. Touch mode is reproduced by writing the
// same custom property observeInputMode writes on a real finger press, so the
// two numbers come from one page load and differ only by that property.
//
//   node scripts/measure-inbox-row.mjs --url http://127.0.0.1:8504/
//   node scripts/measure-inbox-row.mjs --url http://127.0.0.1:8504/ --posture unfolded-landscape
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, findChrome, getFreePort, launchChrome, openPage, sleep, waitForDebugger } from "./lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_POSTURES } from "./lib/fold8-postures.mjs";

const OPEN_INBOX = `
  (() => {
    const walk = (root, out) => {
      for (const element of root.querySelectorAll("*")) {
        out.push(element);
        if (element.shadowRoot) walk(element.shadowRoot, out);
      }
      return out;
    };
    const all = walk(document, []);
    if (all.some((element) => element.tagName === "SESSION-INBOX-PANEL")) return "already-open";
    const opener = all.find((element) => {
      const label = (element.getAttribute?.("aria-label") ?? "") + " " + (element.title ?? "");
      return /session|inbox|navigation/iu.test(label) && typeof element.click === "function";
    });
    if (!opener) return "no-opener";
    opener.click();
    return "clicked";
  })()
`;

const MEASURE = `
  (() => {
    const walk = (root, out) => {
      for (const element of root.querySelectorAll("*")) {
        out.push(element);
        if (element.shadowRoot) walk(element.shadowRoot, out);
      }
      return out;
    };
    const panel = walk(document, []).find((element) => element.tagName === "SESSION-INBOX-PANEL");
    if (!panel) return { error: "session-inbox-panel not found" };
    const rows = walk(panel.shadowRoot ?? panel, []).filter((element) => element.classList.contains("row"));
    if (rows.length === 0) return { error: "no .row elements", panelHeight: Math.round(panel.getBoundingClientRect().height) };

    const box = (element) => (element ? Math.round(element.getBoundingClientRect().height * 10) / 10 : null);
    const outer = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      const margins = parseFloat(style.marginBlockStart || "0") + parseFloat(style.marginBlockEnd || "0");
      return Math.round((element.getBoundingClientRect().height + margins) * 10) / 10;
    };

    const sample = rows.map((row) => {
      const style = getComputedStyle(row);
      const actions = row.querySelector(".row-actions");
      const actionsShown = actions !== null && getComputedStyle(actions).display !== "none";
      return {
        rowHeight: box(row),
        paddingBlock: parseFloat(style.paddingBlockStart) + parseFloat(style.paddingBlockEnd),
        rowGap: parseFloat(style.rowGap || "0"),
        titleHeight: box(row.querySelector(".row-title")),
        metaHeight: box(row.querySelector(".row-meta")),
        timeHeight: box(row.querySelector(".row-time")),
        actionsHeight: actionsShown ? box(actions) : 0,
        actionsOuterHeight: actionsShown ? outer(actions) : 0,
        actionButtonHeight: actionsShown ? box(row.querySelector(".row-action")) : 0,
      };
    });

    const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const keys = Object.keys(sample[0]);
    const summary = {};
    for (const key of keys) summary[key] = median(sample.map((entry) => entry[key]));

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panelWidth: Math.round(panel.getBoundingClientRect().width),
      rowCount: rows.length,
      rowHeightMin: Math.min(...sample.map((entry) => entry.rowHeight)),
      rowHeightMax: Math.max(...sample.map((entry) => entry.rowHeight)),
      median: summary,
    };
  })()
`;

const SET_TOUCH_MODE = `
  (() => {
    document.documentElement.style.setProperty("--pi-row-actions-display", "none");
    return "touch";
  })()
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN or install chromium.");
  if (args.url === undefined) fail("--url is required");
  const postures = args.posture === "all"
    ? FOLD8_POSTURES
    : FOLD8_POSTURES.filter((candidate) => candidate.name === args.posture);
  if (postures.length === 0) fail(`--posture must be 'all' or one of ${FOLD8_POSTURES.map((p) => p.name).join(", ")}`);

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-inbox-measure-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
  try {
    await waitForDebugger(debugPort);
    for (const posture of postures) {
      const cdp = await openPage(debugPort);
      try {
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: posture.width,
          height: posture.height,
          deviceScaleFactor: FOLD8_DPR,
          mobile: true,
        });
        const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
        await cdp.send("Page.navigate", { url: args.url });
        await loaded;
        await sleep(args.settle);

        const opened = await evaluate(cdp, OPEN_INBOX);
        if (opened !== "already-open") await sleep(1200);

        const mouse = await evaluate(cdp, MEASURE);
        await evaluate(cdp, SET_TOUCH_MODE);
        await sleep(200);
        const touch = await evaluate(cdp, MEASURE);

        process.stdout.write(`${JSON.stringify({ posture: posture.name, opened, mouse, touch }, null, 2)}\n`);
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

function parseArgs(argv) {
  const parsed = { posture: "unfolded-landscape", settle: 4500 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--posture") parsed.posture = argv[++i];
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else if (arg === "--settle") parsed.settle = Number(argv[++i]);
    else fail(`Unknown argument ${arg}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
