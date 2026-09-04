#!/usr/bin/env node
// Photographs one transcript fixture state across the Fold 8 postures, so a
// layout decision can be looked at rather than reasoned about.
//
// The layout checker measures boxes; this shows what a reader sees. Both drive
// the same built fixture, so the picture is of the shipped components and the
// app's own tokens, not of a hand-made copy of them.
//
//   node scripts/capture-stacked-table.mjs --out /tmp/shots --state table
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "./lib/cdp.mjs";
import { buildFixture, serveDirectory } from "./lib/fixture-site.mjs";
import { FOLD8_POSTURES } from "./lib/fold8-postures.mjs";
import { openPosturePage } from "./lib/posture-page.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN.");

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-shot-"));
  const fixtureDir = join(tempRoot, "fixture");
  await buildFixture(fixtureDir);
  const server = await serveDirectory(fixtureDir);
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));
  await mkdir(args.out, { recursive: true });

  try {
    await waitForDebugger(debugPort);
    for (const posture of FOLD8_POSTURES) {
      for (const colorScheme of args.schemes) {
        const cdp = await openPosturePage({ debugPort, posture, colorScheme });
        try {
          const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
          await cdp.send("Page.navigate", { url: `${server.origin}/index.html` });
          await loaded;
          await sleep(400);
          await evaluate(cdp, `window.mountTranscript(${JSON.stringify(args.state)})`);
          await sleep(300);
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          const name = `${args.label}-${args.state}-${posture.name}-${colorScheme}.png`;
          await writeFile(join(args.out, name), Buffer.from(data, "base64"));
          process.stdout.write(`${join(args.out, name)}\n`);
        } finally {
          cdp.close();
        }
      }
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const parsed = { out: "/tmp/forgerie-shots", state: "table", label: "shot", schemes: ["dark"] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--state") parsed.state = argv[++i];
    else if (arg === "--label") parsed.label = argv[++i];
    else if (arg === "--schemes") parsed.schemes = argv[++i].split(",");
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
