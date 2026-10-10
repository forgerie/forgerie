#!/usr/bin/env node
// Captures the Fold 8 acceptance posture matrix from AGENTS.md against a
// running Forgerie instance, optionally after driving the UI (shadow-DOM aware).
//
//   node scripts/capture-postures.mjs --url http://127.0.0.1:8504/ --out /tmp/shots --label slice2
//   node scripts/capture-postures.mjs --url ... --click-title Sessions --label overlay
//   node scripts/capture-postures.mjs --url ... --press ctrl+k --click-title "New Prompt"
//   node scripts/capture-postures.mjs --url ... --type "/" --settle 1500
//   node scripts/capture-postures.mjs --url ... --click-title "New session" --click-title Choose --click-text Local
//
// --click-title and --click-text steps run in the order given. --click-text
// matches a button by the words it starts with, for rows that carry no title.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "./lib/cdp.mjs";
import { FOLD8_POSTURES } from "./lib/fold8-postures.mjs";
import { drivePage, openPosturePage, requireColorScheme } from "./lib/posture-page.mjs";

export { FOLD8_POSTURES };

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
  const cdp = await openPosturePage({ debugPort, posture, colorScheme: args.colorScheme });
  try {
    await drivePage(cdp, { ...args, label: posture.name });

    await mkdir(dirname(outputPath), { recursive: true });
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(outputPath, Buffer.from(data, "base64"));
  } finally {
    cdp.close();
  }
}

function parseArgs(argv) {
  const parsed = { out: "/tmp/forgerie-postures", label: "posture", settle: 4000, timeout: 20000, clickTitles: [], presses: [], types: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--label") parsed.label = argv[++i];
    else if (arg === "--click-title") parsed.clickTitles.push(argv[++i]);
    else if (arg === "--click-text") parsed.clickTitles.push({ text: argv[++i] });
    else if (arg === "--press") parsed.presses.push(argv[++i]);
    else if (arg === "--type") parsed.types.push(argv[++i]);
    else if (arg === "--input-mode") parsed.inputMode = argv[++i];
    else if (arg === "--color-scheme") parsed.colorScheme = requireColorScheme(argv[++i]);
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
