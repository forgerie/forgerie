#!/usr/bin/env node
// Captures the inline transcript image band across the Fold 8 posture matrix.
//
// The generic posture capture lands at the foot of a transcript, so an image
// part further up never appears in the frame. This script opens a session,
// scrolls the transcript scroller until the first `.chat-image` is centred,
// and screenshots that view in every posture and colour scheme.
//
//   node scripts/capture-chat-image-band.mjs --url "http://127.0.0.1:8504/?..." \
//     --out /tmp/shots --label band --color-scheme dark
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  evaluate,
  findChrome,
  getFreePort,
  launchChrome,
  openPage,
  sleep,
  waitForDebugger,
} from "./lib/cdp.mjs";
import { FOLD8_DPR, FOLD8_POSTURES } from "./lib/fold8-postures.mjs";

const SHOW_IMAGE = `
  (() => {
    const walk = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.classList.contains("chat-image")) return element;
        if (element.shadowRoot) {
          const found = walk(element.shadowRoot);
          if (found) return found;
        }
      }
      return undefined;
    };
    const image = walk(document);
    if (!image) return { found: false };
    const scroller = image.closest(".chat");
    if (!scroller) return { found: false };
    const offset = image.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += offset - scroller.clientHeight / 4;
    const box = image.getBoundingClientRect();
    return {
      found: true,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      renderedWidth: Math.round(box.width),
      renderedHeight: Math.round(box.height),
    };
  })()
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromeBin = args.chromeBin ?? process.env["CHROME_BIN"] ?? findChrome();
  if (chromeBin === undefined) fail("Chromium not found. Set CHROME_BIN or install chromium.");
  if (args.url === undefined) fail("--url is required");

  const tempRoot = await mkdtemp(join(tmpdir(), "forgerie-band-"));
  const debugPort = await getFreePort();
  const chrome = launchChrome(chromeBin, debugPort, join(tempRoot, "profile"));

  try {
    await waitForDebugger(debugPort);
    for (const posture of FOLD8_POSTURES) {
      await capture({ debugPort, posture, args });
    }
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function capture({ debugPort, posture, args }) {
  const outputPath = join(args.out, `${args.label}-${posture.name}.png`);
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
    if (args.colorScheme !== undefined) {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: args.colorScheme }],
      });
    }

    const loaded = cdp.waitForEvent("Page.loadEventFired", args.timeout).catch(() => undefined);
    await cdp.send("Page.navigate", { url: args.url });
    await loaded;
    await sleep(args.settle);

    const measured = await evaluate(cdp, SHOW_IMAGE);
    await sleep(600);
    process.stdout.write(`  ${posture.name}: ${JSON.stringify(measured)}\n`);

    await mkdir(dirname(outputPath), { recursive: true });
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(outputPath, Buffer.from(data, "base64"));
    process.stdout.write(`captured ${outputPath}\n`);
  } finally {
    cdp.close();
  }
}

function parseArgs(argv) {
  const parsed = { out: "/tmp/forgerie-band", label: "band", settle: 6000, timeout: 20000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") parsed.url = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--label") parsed.label = argv[++i];
    else if (arg === "--color-scheme") parsed.colorScheme = requireColorScheme(argv[++i]);
    else if (arg === "--chrome-bin") parsed.chromeBin = argv[++i];
    else if (arg === "--settle") parsed.settle = Number(argv[++i]);
    else fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function requireColorScheme(value) {
  if (value === "dark" || value === "light") return value;
  fail(`--color-scheme must be dark or light, got ${JSON.stringify(value)}`);
  return undefined;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await main();
