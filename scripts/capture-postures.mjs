#!/usr/bin/env node
// Captures the Fold 8 acceptance posture matrix from AGENTS.md against a
// running Forgerie instance, optionally after driving the UI (shadow-DOM aware).
//
//   node scripts/capture-postures.mjs --url http://127.0.0.1:8504/ --out /tmp/shots --label slice2
//   node scripts/capture-postures.mjs --url ... --click-title Sessions --label overlay
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CDP,
  evaluate,
  findChrome,
  getFreePort,
  launchChrome,
  openPage,
  sleep,
  waitForDebugger,
} from "./lib/cdp.mjs";

/** CSS-pixel viewports for the Galaxy Z Fold 8 (non-Ultra). See AGENTS.md. */
export const FOLD8_POSTURES = [
  { name: "unfolded-portrait", width: 739, height: 979 },
  { name: "unfolded-landscape", width: 979, height: 739 },
  { name: "folded-portrait", width: 499, height: 789 },
  { name: "folded-landscape", width: 789, height: 499 },
];

const DEEP_QUERY = `
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
    window.__forgerieDeepFind = (test) => walk(document, test);
  })()
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN or install chromium.");
  if (args.url === undefined) fail("--url is required");

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-postures-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
  const captured = [];

  try {
    await waitForDebugger(debugPort);
    for (const posture of FOLD8_POSTURES) {
      const outputPath = join(args.out, `${args.label}-${posture.name}.png`);
      await capturePosture({ debugPort, posture, args, outputPath });
      captured.push(outputPath);
      process.stdout.write(`captured ${outputPath}\n`);
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }

  return captured;
}

async function capturePosture({ debugPort, posture, args, outputPath }) {
  const cdp = await openPage(debugPort);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: posture.width,
      height: posture.height,
      deviceScaleFactor: 1,
      mobile: true,
    });

    const loaded = cdp.waitForEvent("Page.loadEventFired", args.timeout).catch(() => undefined);
    await cdp.send("Page.navigate", { url: args.url });
    await loaded;
    await sleep(args.settle);

    if (args.clickTitle !== undefined) {
      await evaluate(cdp, DEEP_QUERY);
      const clicked = await evaluate(cdp, `
        (() => {
          const target = window.__forgerieDeepFind((element) =>
            element.tagName === "BUTTON" && element.getAttribute("title") === ${JSON.stringify(args.clickTitle)});
          if (!target) return false;
          target.click();
          return true;
        })()
      `);
      if (clicked !== true) throw new Error(`No button titled ${JSON.stringify(args.clickTitle)} in ${posture.name}`);
      await sleep(args.settle);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(outputPath, Buffer.from(data, "base64"));
  } finally {
    cdp.close();
  }
}

function parseArgs(argv) {
  const parsed = { out: "/tmp/forgerie-postures", label: "posture", settle: 4000, timeout: 20000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--label") parsed.label = argv[++i];
    else if (arg === "--click-title") parsed.clickTitle = argv[++i];
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else if (arg === "--settle") parsed.settle = Number(argv[++i]);
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
