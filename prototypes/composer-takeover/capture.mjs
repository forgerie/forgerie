#!/usr/bin/env nix-shell
//usr/bin/env nix-shell -i node -p nodejs_22 "$0" "$@"; exit $?
/**
 * Captures the takeover at the ladder sizes, including the keyboard-up shapes
 * the acceptance posture list does not carry.
 *
 * Emulation goes through CDP, never `--window-size`: a Chromium window is not a
 * viewport, and the difference previously produced clipped-control reports the
 * device did not actually have.
 *
 *   node capture.mjs --out /tmp/ct --fixture few
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, getFreePort, launchChrome, sleep, waitForDebugger } from "../../scripts/lib/cdp.mjs";
import { drivePage, openPosturePage, requireColorScheme } from "../../scripts/lib/posture-page.mjs";

/** The keyboard-up heights are the acceptance postures minus a measured-ish keyboard. */
const SIZES = [
  { name: "unfolded-portrait", width: 704, height: 783 },
  { name: "unfolded-portrait-keyboard", width: 704, height: 430 },
  { name: "unfolded-landscape", width: 932, height: 553 },
  { name: "unfolded-landscape-keyboard", width: 932, height: 300 },
  { name: "folded-portrait", width: 475, height: 638 },
  { name: "folded-portrait-keyboard", width: 475, height: 350 },
  { name: "folded-landscape", width: 711, height: 374 },
  { name: "folded-landscape-keyboard", width: 711, height: 184 },
  { name: "wide-strip", width: 1280, height: 170 },
  { name: "tiny", width: 320, height: 480 },
];

async function main() {
  const args = parse(process.argv.slice(2));
  const chromeBin = process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) throw new Error("Chromium not found. Set CHROME_BIN.");

  const tempRoot = await mkdtemp(join(tmpdir(), "composer-takeover-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));

  try {
    await waitForDebugger(debugPort);
    await mkdir(args.out, { recursive: true });
    for (const posture of SIZES) {
      const cdp = await openPosturePage({ debugPort, posture, colorScheme: args.colorScheme });
      try {
        await drivePage(cdp, {
          url: `${args.url}?embed=1&fixture=${args.fixture}`,
          settle: 700,
          label: posture.name,
        });
        const { data } = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });
        const path = join(args.out, `${args.fixture}-${posture.name}.png`);
        await writeFile(path, Buffer.from(data, "base64"));
        process.stdout.write(`captured ${path}\n`);
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

function parse(argv) {
  const parsed = {
    url: "http://127.0.0.1:8600/composer-takeover/index.html",
    out: "/tmp/composer-takeover",
    fixture: "few",
    // Light only: the prototype ships one palette, so capturing dark would only
    // photograph tokens that are not in the stylesheet.
    colorScheme: "light",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--url") parsed.url = argv[++index];
    else if (arg === "--out") parsed.out = argv[++index];
    else if (arg === "--fixture") parsed.fixture = argv[++index];
    else if (arg === "--color-scheme") parsed.colorScheme = requireColorScheme(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

await main();
