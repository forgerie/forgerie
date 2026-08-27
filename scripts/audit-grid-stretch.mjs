#!/usr/bin/env node
// Reports grid containers in a running Forgerie instance whose row sizing is
// being decided by the initial align-content, across the Fold 8 postures.
//
//   node scripts/audit-grid-stretch.mjs --url http://127.0.0.1:8504/
//   node scripts/audit-grid-stretch.mjs --url ... --press ctrl+k --label palette
//
// Findings come in two kinds. A spread pulls several rows apart and is almost
// always a defect: it reads as mysterious padding. A fill grows a single row to
// the height of its box, which is how a grid centres its content and is usually
// intended. Both are the stylesheet staying silent about a decision the engine
// is making, so both are reported and the two are told apart.
//
// Exits non-zero when a spread is found, so it can gate a change.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "./lib/cdp.mjs";
import { FOLD8_POSTURES } from "./lib/fold8-postures.mjs";
import { GRID_STRETCH_PROBE } from "./lib/grid-stretch-probe.mjs";
import { drivePage, openPosturePage, requireColorScheme } from "./lib/posture-page.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN or install chromium.");
  if (args.url === undefined) fail("--url is required");

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-grid-audit-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
  const byPath = new Map();

  try {
    await waitForDebugger(debugPort);
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort, posture, colorScheme: args.colorScheme });
      try {
        await drivePage(cdp, { ...args, label: `${args.label}/${posture.name}` });
        const findings = JSON.parse(String(await evaluate(cdp, GRID_STRETCH_PROBE)));
        process.stderr.write(`${posture.name}: ${findings.length} finding(s)\n`);
        for (const finding of findings) {
          const seen = byPath.get(finding.path);
          if (seen === undefined) byPath.set(finding.path, { ...finding, postures: new Set([posture.name]) });
          else seen.postures.add(posture.name);
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

  return report([...byPath.values()]);
}

function report(findings) {
  const spreads = findings.filter((finding) => finding.kind === "spread").sort((a, b) => b.spreadPx - a.spreadPx);
  const fills = findings.filter((finding) => finding.kind === "fill").sort((a, b) => b.spreadPx - a.spreadPx);

  write(`\nSpread — rows pulled apart (${spreads.length}):\n`);
  if (spreads.length === 0) write("  none\n");
  for (const finding of spreads) writeFinding(finding);

  write(`\nFill — one row grown to its box, usually a centring idiom (${fills.length}):\n`);
  if (fills.length === 0) write("  none\n");
  for (const finding of fills) writeFinding(finding);

  return spreads.length === 0 ? 0 : 1;
}

function writeFinding(finding) {
  write(`  ${finding.path}\n`);
  write(`    rows=${finding.rows} items=${finding.items} height=${finding.height}px `);
  write(`spread=${finding.spreadPx}px grown=${finding.grownPx}px\n`);
  write(`    postures: ${[...finding.postures].join(", ")}\n`);
}

function write(text) {
  process.stdout.write(text);
}

function parseArgs(argv) {
  const parsed = { label: "audit", settle: 2500, timeout: 20000, clickTitles: [], presses: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--label") parsed.label = argv[++i];
    else if (arg === "--click-title") parsed.clickTitles.push(argv[++i]);
    else if (arg === "--press") parsed.presses.push(argv[++i]);
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

process.exitCode = await main();
