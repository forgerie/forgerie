#!/usr/bin/env node
// Photographs the inbox layout fixture at each Fold posture, one PNG per
// inbox state, so a column change can be looked at as well as measured.
//
//   node scripts/shoot-inbox-fixture.mjs --out /tmp/inbox-shots [--chrome-bin PATH]
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
  if (chromeBin === undefined) fail("Chromium not found; pass --chrome-bin.");
  await mkdir(args.out, { recursive: true });

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-shoot-"));
  const fixtureDir = join(tempRoot, "fixture");
  await buildFixture(fixtureDir);
  const server = await serveDirectory(fixtureDir);
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));

  try {
    await waitForDebugger(debugPort);
    const url = `${server.origin}/index.html`;
    for (const posture of FOLD8_POSTURES) {
      const cdp = await openPosturePage({ debugPort, posture, colorScheme: "dark" });
      try {
        const loaded = cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => undefined);
        await cdp.send("Page.navigate", { url });
        await loaded;
        await sleep(400);
        const states = JSON.parse(String(await evaluate(cdp, "JSON.stringify(window.inboxStates)")));
        for (const state of states) {
          await evaluate(cdp, `window.mountInbox(${JSON.stringify(state)})`);
          await sleep(200);
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
          const file = join(args.out, `${posture.name}-inbox-${state}.png`);
          await writeFile(file, Buffer.from(data, "base64"));
          process.stderr.write(`${file}\n`);
        }
      } finally {
        cdp.close();
      }
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
  return 0;
}

function parseArgs(argv) {
  const parsed = { out: "/tmp/inbox-shots" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

process.exitCode = await main();
